import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

// $4 picks a catalogue template by purpose: reminder → class.reminder, marketing → promo.generic.
const ENQUEUE = `SELECT app.enqueue_message($1, $2, $3,
  CASE $4::text WHEN 'marketing' THEN 'promo.generic' ELSE 'class.reminder' END, 'es',
  CASE $4::text WHEN 'marketing' THEN '{"discount":"20%","date":"2026-11-30"}'
                ELSE '{"class_name":"Spinning","date":"2026-11-03","time":"18:00"}' END::jsonb) AS id`;
/** Two statements on purpose: rows inserted by a function are not visible to the statement that called it. */
async function enqueue(tx: Tx, args: unknown[]) {
  const { rows } = await tx.query<{ id: string }>(ENQUEUE, args);
  return tx.query(
    "SELECT status, block_reason, scheduled_for FROM app.outbound_message WHERE id = $1",
    [rows[0]?.id],
  );
}

describe("pure helpers", () => {
  it.each([
    ["2026-11-02 10:00", "2026-11-02 10:00"], // inside window → now
    ["2026-11-02 07:00", "2026-11-02 08:00"], // before window → 08:00 same day
    ["2026-11-02 21:00", "2026-11-03 08:00"], // window end is exclusive → next day
    ["2026-11-02 23:30", "2026-11-03 08:00"],
  ])("next_allowed_send(%s PR) = %s", async (local, expected) => {
    const { rows } = await t.admin.query(
      `SELECT to_char(app.next_allowed_send(($1::timestamp AT TIME ZONE 'America/Puerto_Rico'), 'America/Puerto_Rico', '08:00', '21:00')
              AT TIME ZONE 'America/Puerto_Rico', 'YYYY-MM-DD HH24:MI') AS r`,
      [local],
    );
    expect(rows[0].r).toBe(expected);
  });

  it.each([
    ["STOP", true],
    [" baja. ", true],
    ["Cancelar", true],
    ["ALTO!", true],
    ["unsubscribe", true],
    ["hola, quiero cancelar mi clase", false],
    ["", false],
  ])("is_opt_out_keyword(%j) = %s", async (body, expected) => {
    const { rows } = await t.admin.query("SELECT app.is_opt_out_keyword($1) AS r", [body]);
    expect(rows[0].r).toBe(expected);
  });
});

describe("consent is required for every message", () => {
  it("a granted (member, brand, channel, purpose) consent queues the message inside the window", async () => {
    const { A } = t.fx;
    const r = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      enqueue(tx, [A.members[0], A.brandId, "sms", "reminder"]),
    );
    expect(r.rows[0].status).toBe("queued");
    const local = await t.admin.query(
      "SELECT ($1::timestamptz AT TIME ZONE 'America/Puerto_Rico')::time AS t",
      [r.rows[0].scheduled_for],
    );
    expect(local.rows[0].t >= "08:00:00" && local.rows[0].t < "21:00:00").toBe(true);
  });

  it("consent for one purpose does not cover another (marketing is blocked)", async () => {
    const { A } = t.fx;
    const r = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      enqueue(tx, [A.members[0], A.brandId, "sms", "marketing"]),
    );
    expect(r.rows[0]).toMatchObject({ status: "blocked", block_reason: "no_consent" });
  });

  it("consent for one channel does not cover another (WhatsApp is blocked)", async () => {
    const { A } = t.fx;
    const r = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      enqueue(tx, [A.members[0], A.brandId, "whatsapp", "reminder"]),
    );
    expect(r.rows[0].status).toBe("blocked");
  });

  it("only front-of-house roles can queue, and only for members they can see", async () => {
    const { A, B } = t.fx;
    for (const role of [
      "trainer",
      "nutritionist",
      "chef",
      "clinician",
      "accountant",
      "member",
      "guardian",
    ] as const) {
      await asCaller(t.api, t.claims(A, role), async (tx) => {
        await expect(
          enqueue(tx, [A.members[0], A.brandId, "sms", "reminder"]),
        ).rejects.toMatchObject({
          code: "42501",
        });
      });
    }
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(enqueue(tx, [A.members[1], A.brandId, "sms", "reminder"])).rejects.toMatchObject(
        {
          code: "42501",
        },
      ); // members[1] is at an unassigned location
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(enqueue(tx, [B.members[0], B.brandId, "sms", "reminder"])).rejects.toMatchObject(
        {
          code: "42501",
        },
      );
    });
  });
});

describe("recording consent", () => {
  const setConsent = "SELECT app.set_consent($1, $2, $3, $4, $5, $6, $7) AS id";

  it("the consent source must match the caller (members via portal, never 'keyword' from request traffic)", async () => {
    const { A } = t.fx;
    const cases: Array<[Parameters<typeof t.claims>[1], string]> = [
      ["member", "front_desk"],
      ["member", "import"],
      ["front_desk", "member_portal"],
      ["front_desk", "import"],
      ["owner", "keyword"],
    ];
    for (const [role, source] of cases) {
      await asCaller(t.api, t.claims(A, role), async (tx) => {
        await expect(
          tx.query("SELECT app.set_consent($1, $2, 'email', 'reminder', false, $3, NULL)", [
            A.members[0],
            A.brandId,
            source,
          ]),
        ).rejects.toMatchObject({ code: "22023" });
      });
    }
  });

  it("the brand must be the brand of the member's home location", async () => {
    const { A } = t.fx;
    const other = await t.admin.query(
      "INSERT INTO app.brand (org_id, legal_entity_id, name) SELECT org_id, legal_entity_id, 'Demo Brand 2' FROM app.brand WHERE id = $1 RETURNING id",
      [A.brandId],
    );
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await expect(
        tx.query(ENQUEUE, [A.members[0], other.rows[0].id, "sms", "reminder"]),
      ).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("a grant needs evidence and cannot come from a keyword", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query(setConsent, [
          A.members[0],
          A.brandId,
          "email",
          "marketing",
          true,
          "front_desk",
          "",
        ]),
      ).rejects.toMatchObject({ code: "22023" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(
        tx.query(setConsent, [A.members[0], A.brandId, "email", "marketing", true, "keyword", "x"]),
      ).rejects.toMatchObject({ code: "22023" });
    });
  });

  it("a member can grant their own consent but not someone else's; a guardian can act for the ward", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "member"), async (tx) => {
      await tx.query(setConsent, [
        A.members[0],
        A.brandId,
        "email",
        "reminder",
        true,
        "member_portal",
        "Demo checkbox v1",
      ]);
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query(setConsent, [
          A.members[1],
          A.brandId,
          "email",
          "reminder",
          true,
          "member_portal",
          "x",
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
    });
    const ward = await t.admin.query(
      "SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1",
      [A.people.guardian],
    );
    await asCaller(t.api, t.claims(A, "guardian"), (tx) =>
      tx.query(setConsent, [
        ward.rows[0].member_id,
        A.brandId,
        "sms",
        "reminder",
        true,
        "member_portal",
        "Demo guardian",
      ]),
    );
    const audit = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'consent.grant'",
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("nobody can write consent rows directly", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await expect(tx.query("UPDATE app.consent SET status = 'granted'")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });
});

describe("opt-out", () => {
  it("revokes every channel and purpose of the brand at once and blocks queued messages", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await tx.query(
        "SELECT app.set_consent($1, $2, 'whatsapp', 'reminder', true, 'front_desk', 'Demo')",
        [A.members[0], A.brandId],
      );
      await enqueue(tx, [A.members[0], A.brandId, "whatsapp", "reminder"]);
    });
    const revoked = await asCaller(t.api, t.claims(A, "member"), (tx) =>
      tx.query("SELECT app.opt_out($1, $2, 'member_portal') AS n", [A.members[0], A.brandId]),
    );
    expect(revoked.rows[0].n).toBeGreaterThanOrEqual(2);
    const left = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.consent WHERE member_id = $1 AND brand_id = $2 AND status = 'granted'",
      [A.members[0], A.brandId],
    );
    expect(left.rows[0].n).toBe(0);
    const queued = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.outbound_message WHERE member_id = $1 AND status = 'queued'",
      [A.members[0]],
    );
    expect(queued.rows[0].n).toBe(0);
    const after = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      enqueue(tx, [A.members[0], A.brandId, "sms", "reminder"]),
    );
    expect(after.rows[0].status).toBe("blocked");
  });

  it("another organisation cannot opt a member out", async () => {
    await asCaller(t.api, t.claims(t.fx.B, "owner"), async (tx) => {
      await expect(
        tx.query("SELECT app.opt_out($1, $2, 'front_desk')", [t.fx.A.members[0], t.fx.A.brandId]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("E8 review regressions", () => {
  const set = "SELECT app.set_consent($1, $2, $3, $4, $5, $6, $7) AS id";

  it("HIGH: revoking one consent blocks messages already queued for it", async () => {
    const { A } = t.fx;
    // The guardian's ward (location 1) has no prior member-made revocation.
    const ward = (
      await t.admin.query("SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1", [
        A.people.guardian,
      ])
    ).rows[0].member_id as string;
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await tx.query(set, [ward, A.brandId, "email", "reminder", true, "front_desk", "Demo"]);
      const r = await enqueue(tx, [ward, A.brandId, "email", "reminder"]);
      expect(r.rows[0].status).toBe("queued");
      await tx.query(set, [ward, A.brandId, "email", "reminder", false, "front_desk", null]);
    });
    const q = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.outbound_message WHERE member_id = $1 AND channel = 'email' AND status = 'queued'",
      [ward],
    );
    expect(q.rows[0].n).toBe(0);
  });

  it("HIGH: only front-of-house staff can record a grant; any staff can record a revocation", async () => {
    const { A } = t.fx;
    for (const role of ["trainer", "chef", "nutritionist", "clinician", "accountant"] as const) {
      await asCaller(t.api, t.claims(A, role), async (tx) => {
        await tx.query("SAVEPOINT s");
        await expect(
          tx.query(set, [A.members[0], A.brandId, "email", "marketing", true, "front_desk", "x"]),
        ).rejects.toMatchObject({ code: "42501" });
        await tx.query("ROLLBACK TO SAVEPOINT s");
        await tx.query(set, [
          A.members[0],
          A.brandId,
          "email",
          "marketing",
          false,
          "front_desk",
          null,
        ]);
      });
    }
  });

  it("HIGH: staff cannot re-grant over a member's own revocation; the member can", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "member"), (tx) =>
      tx.query(set, [
        A.members[0],
        A.brandId,
        "whatsapp",
        "marketing",
        false,
        "member_portal",
        null,
      ]),
    );
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await expect(
        tx.query(set, [A.members[0], A.brandId, "whatsapp", "marketing", true, "front_desk", "x"]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    await asCaller(t.api, t.claims(A, "member"), (tx) =>
      tx.query(set, [
        A.members[0],
        A.brandId,
        "whatsapp",
        "marketing",
        true,
        "member_portal",
        "Demo re-opt-in",
      ]),
    );
  });

  it("HIGH: an opt-out racing an enqueue never leaves a message queued without consent", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "owner"), (tx) =>
      tx.query(set, [A.members[1], A.brandId, "sms", "reminder", true, "front_desk", "Demo"]),
    );
    // members[1] is at locations[1]: use the owner (org-wide) to enqueue.
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, t.claims(A, "owner"));
      await enqueue(c1, [A.members[1], A.brandId, "sms", "reminder"]); // holds FOR SHARE on the consent row
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, t.claims(A, "owner"));
      const optOut = c2.query("SELECT app.opt_out($1, $2, 'front_desk')", [
        A.members[1],
        A.brandId,
      ]);
      await new Promise((r) => setTimeout(r, 100));
      await c1.query("COMMIT");
      await optOut;
      await c2.query("COMMIT");
    } finally {
      c1.release();
      c2.release();
    }
    const q = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.outbound_message WHERE member_id = $1 AND status = 'queued'",
      [A.members[1]],
    );
    expect(q.rows[0].n).toBe(0);
  });

  it("MEDIUM: every grant and revocation is kept in an append-only history with its evidence", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await tx.query(set, [
        A.members[0],
        A.brandId,
        "email",
        "transactional",
        true,
        "web_form",
        "Demo form v3",
      ]);
      await tx.query(set, [
        A.members[0],
        A.brandId,
        "email",
        "transactional",
        false,
        "front_desk",
        null,
      ]);
      const h = await tx.query(
        "SELECT status, evidence FROM app.consent_event WHERE member_id = $1 AND channel = 'email' AND purpose = 'transactional' ORDER BY id",
        [A.members[0]],
      );
      expect(h.rows).toEqual([
        { status: "granted", evidence: "Demo form v3" },
        { status: "revoked", evidence: null },
      ]);
      await tx.query("SAVEPOINT s");
      await expect(tx.query("DELETE FROM app.consent_event")).rejects.toMatchObject({
        code: "42501",
      });
      await tx.query("ROLLBACK TO SAVEPOINT s");
    });
  });

  it("MEDIUM: the database refuses a direct call with a body or an unknown template", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await expect(
        tx.query("SELECT app.enqueue_message($1, $2, 'sms', 'promo.free_text', 'es', '{}')", [
          A.members[0],
          A.brandId,
        ]),
      ).rejects.toMatchObject({ code: "22023" });
    });
  });

  it("LOW: internal helpers are not callable by request traffic", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "member"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query("SELECT app.check_member_brand($1, $2)", [A.members[1], A.brandId]),
      ).rejects.toMatchObject({ code: "42501" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(
        tx.query("SELECT * FROM app.render_message('class.reminder', 'es', $1, $2, '{}')", [
          A.members[1],
          A.brandId,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("LOW: the sending window cannot be widened beyond 08:00–21:00", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await expect(
        tx.query("UPDATE app.message_policy SET window_start = '00:00', window_end = '23:59'"),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
