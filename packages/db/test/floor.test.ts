import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Module floor (migration 0011): equipment, issues, exercise library, circuits, runs and set logs.
let t: TestDb;
let member2A: string; // person id of A.members[1] (home at location 2)
beforeAll(async () => {
  t = await createTestDb();
  member2A = (
    await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [t.fx.A.members[1]])
  ).rows[0].person_id;
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const as = (org: OrgFixture, role: Role, personId?: string) => t.claims(org, role, personId);
async function assetId(code: string, org: OrgFixture = t.fx.A): Promise<string> {
  const r = await t.admin.query(
    "SELECT id FROM app.asset WHERE org_id = $1 AND station_code = $2",
    [org.orgId, code],
  );
  return r.rows[0].id;
}
async function exerciseId(name: string, org: OrgFixture = t.fx.A): Promise<string> {
  const r = await t.admin.query("SELECT id FROM app.exercise WHERE org_id = $1 AND name = $2", [
    org.orgId,
    name,
  ]);
  return r.rows[0].id;
}
let seq = 0;
/** A fresh asset owned by one test, so tests never depend on rows another test mutated. */
async function newAsset(org: OrgFixture, loc: 0 | 1, type = "bench"): Promise<string> {
  seq += 1;
  const r = await t.admin.query(
    `INSERT INTO app.asset (org_id, location_id, equipment_type, station_code)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [org.orgId, org.locations[loc], type, `T-${seq}-${loc}`],
  );
  return r.rows[0].id;
}
async function report(org: OrgFixture, role: Role, asset: string, kind: string, personId?: string) {
  return asCaller(t.api, as(org, role, personId), async (tx) => {
    const r = await tx.query<{ id: string }>(
      "SELECT app.report_asset_issue($1, $2, 'Demo nota') AS id",
      [asset, kind],
    );
    return r.rows[0]?.id as string;
  });
}
const assetStatus = async (id: string) =>
  (await t.admin.query("SELECT status FROM app.asset WHERE id = $1", [id])).rows[0].status;
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

describe("reads: who sees equipment, circuits and the library", () => {
  it("members see the equipment and active circuits of every location of their org", async () => {
    const A = t.fx.A;
    await asCaller(t.api, as(A, "member"), async (tx) => {
      const locs = (await tx.query("SELECT DISTINCT location_id FROM app.asset")).rows;
      expect(locs.map((r) => r.location_id).sort()).toEqual([...A.locations].sort());
      expect((await tx.query("SELECT 1 FROM app.circuit")).rowCount).toBeGreaterThan(0);
      expect((await tx.query("SELECT 1 FROM app.circuit_step")).rowCount).toBe(3);
      expect((await tx.query("SELECT 1 FROM app.exercise")).rowCount).toBeGreaterThan(5);
    });
  });

  it("scoped staff see equipment only at their assigned location", async () => {
    const A = t.fx.A;
    for (const role of ["trainer", "front_desk", "location_manager"] as Role[]) {
      await asCaller(t.api, as(A, role), async (tx) => {
        const { rows } = await tx.query("SELECT DISTINCT location_id FROM app.asset");
        expect(
          rows.map((r) => r.location_id),
          role,
        ).toEqual([A.locations[0]]);
      });
    }
  });

  it("inactive circuits are hidden from members but visible to the location's staff", async () => {
    const A = t.fx.A;
    const c = (
      await t.admin.query(
        "INSERT INTO app.circuit (org_id, location_id, name, active) VALUES ($1, $2, 'Demo inactivo', false) RETURNING id",
        [A.orgId, A.locations[0]],
      )
    ).rows[0].id;
    const seen = async (role: Role) =>
      asCaller(
        t.api,
        as(A, role),
        async (tx) => (await tx.query("SELECT 1 FROM app.circuit WHERE id = $1", [c])).rowCount,
      );
    expect(await seen("member")).toBe(0);
    expect(await seen("trainer")).toBe(1);
  });
});

describe("set logs are private training data", () => {
  it("a member sees only their own set logs and runs, never another member's", async () => {
    const A = t.fx.A;
    await asCaller(t.api, as(A, "member"), async (tx) => {
      const logs = await tx.query("SELECT member_id FROM app.set_log");
      expect(logs.rowCount).toBeGreaterThan(0);
      expect(new Set(logs.rows.map((r) => r.member_id))).toEqual(new Set([A.members[0]]));
      const direct = await tx.query("SELECT 1 FROM app.set_log WHERE member_id = $1", [
        A.members[1],
      ]);
      expect(direct.rowCount).toBe(0);
      const runs = await tx.query("SELECT member_id FROM app.circuit_run");
      expect(runs.rows.every((r) => r.member_id === A.members[0])).toBe(true);
    });
    await asCaller(t.api, as(A, "member", member2A), async (tx) => {
      const logs = await tx.query("SELECT member_id FROM app.set_log");
      expect(new Set(logs.rows.map((r) => r.member_id))).toEqual(new Set([A.members[1]]));
    });
  });

  it.each(["front_desk", "accountant", "chef", "clinician", "nutritionist", "guardian"] as Role[])(
    "%s sees no set logs and no runs",
    async (role) => {
      await asCaller(t.api, as(t.fx.A, role), async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.set_log")).rowCount).toBe(0);
        expect((await tx.query("SELECT 1 FROM app.circuit_run")).rowCount).toBe(0);
      });
    },
  );

  it("a trainer sees logs made at their location only; the owner sees the whole org", async () => {
    const A = t.fx.A;
    const trainer = await asCaller(t.api, as(A, "trainer"), async (tx) =>
      (await tx.query("SELECT DISTINCT location_id FROM app.set_log")).rows.map(
        (r) => r.location_id,
      ),
    );
    expect(trainer).toEqual([A.locations[0]]);
    const owner = await asCaller(t.api, as(A, "owner"), async (tx) =>
      (await tx.query("SELECT DISTINCT location_id FROM app.set_log")).rows.map(
        (r) => r.location_id,
      ),
    );
    expect(owner.sort()).toEqual([...A.locations].sort());
  });

  it("a guardian reads the ward's logs (read only)", async () => {
    const A = t.fx.A;
    const ward = (
      await t.admin.query("SELECT member_id FROM app.guardian_link WHERE org_id = $1", [A.orgId])
    ).rows[0].member_id;
    const pushup = await exerciseId("Flexiones");
    await t.admin.query(
      `INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, reps, weight_kg)
       VALUES ($1, $2, $3, $4, 12, 0)`,
      [A.orgId, ward, A.locations[0], pushup],
    );
    const rows = await asCaller(
      t.api,
      as(A, "guardian"),
      async (tx) => (await tx.query("SELECT member_id FROM app.set_log")).rows,
    );
    expect(rows.map((r) => r.member_id)).toEqual([ward]);
    await expect(
      asCaller(t.api, as(A, "guardian"), (tx) =>
        tx.query("SELECT app.log_set($1, $2, NULL, NULL, 5, 0)", [pushup, A.locations[0]]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("no role can insert or edit set logs directly (only through app.log_set)", async () => {
    const A = t.fx.A;
    for (const role of ["member", "owner", "trainer"] as Role[]) {
      await expect(
        asCaller(t.api, as(A, role), (tx) =>
          tx.query(
            "INSERT INTO app.set_log (member_id, location_id, exercise_id, reps) VALUES ($1, $2, $3, 1)",
            [A.members[0], A.locations[0], A.members[0]],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asCaller(t.api, as(A, role), (tx) => tx.query("UPDATE app.set_log SET reps = 99")),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("the other organisation cannot read or write A's logs", async () => {
    const { A, B } = t.fx;
    const squat = await exerciseId("Sentadilla con barra");
    for (const role of ["owner", "trainer", "member"] as Role[]) {
      const n = await asCaller(
        t.api,
        as(B, role),
        async (tx) =>
          (await tx.query("SELECT 1 FROM app.set_log WHERE member_id = ANY($1)", [A.members]))
            .rowCount,
      );
      expect(n, role).toBe(0);
    }
    await expect(
      asCaller(t.api, as(B, "member"), (tx) =>
        tx.query("SELECT app.log_set($1, $2, NULL, NULL, 5, 20)", [squat, A.locations[0]]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asCaller(t.api, as(B, "member"), (tx) =>
        tx.query("SELECT app.log_set($1, $2, NULL, NULL, 5, 20)", [squat, B.locations[0]]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("substitute_exercise", () => {
  type Sub = {
    exercise_id: string;
    movement_pattern: string;
    equipment_type: string;
    asset_id: string | null;
    same_exercise: boolean;
  };
  const subs = (
    org: OrgFixture,
    role: Role,
    exercise: string,
    loc: string,
    exclude: string | null,
  ) =>
    asCaller(
      t.api,
      as(org, role),
      async (tx) =>
        (
          await tx.query<Sub>("SELECT * FROM app.substitute_exercise($1, $2, $3)", [
            exercise,
            loc,
            exclude,
          ])
        ).rows,
    );

  it("returns only same-pattern exercises whose equipment is available (ok) at that location", async () => {
    const A = t.fx.A;
    const bar = await assetId("A1-BAR-01");
    const r = await subs(
      A,
      "member",
      await exerciseId("Sentadilla con barra"),
      A.locations[0],
      bar,
    );
    const names = new Map(
      (
        await t.admin.query("SELECT id, name FROM app.exercise WHERE org_id = $1", [A.orgId])
      ).rows.map((x) => [x.id, x.name]),
    );
    expect(r.map((x) => names.get(x.exercise_id)).sort()).toEqual(
      ["Prensa de piernas", "Sentadilla al aire"].sort(),
    );
    expect(r.every((x) => x.movement_pattern === "squat")).toBe(true);
    for (const x of r.filter((y) => y.asset_id)) {
      const a = await t.admin.query("SELECT status, location_id, id FROM app.asset WHERE id = $1", [
        x.asset_id,
      ]);
      expect(a.rows[0]).toMatchObject({ status: "ok", location_id: A.locations[0] });
      expect(x.asset_id).not.toBe(bar);
    }
  });

  it("never offers equipment that is out of service or under maintenance", async () => {
    const A = t.fx.A;
    // Leg press at location 1: LP-01 is excluded (reported), LP-02 is out of service → no leg press option.
    const r = await subs(
      A,
      "member",
      await exerciseId("Prensa de piernas"),
      A.locations[0],
      await assetId("A1-LP-01"),
    );
    expect(r.some((x) => x.equipment_type === "leg_press")).toBe(false);
    // Treadmill under maintenance → no cardio substitute at location 1.
    const c = await subs(
      A,
      "member",
      await exerciseId("Caminata en caminadora"),
      A.locations[0],
      null,
    );
    expect(c).toEqual([]);
  });

  it("depends on the location's equipment and offers another free station of the same type", async () => {
    const A = t.fx.A;
    const r = await subs(
      A,
      "member",
      await exerciseId("Sentadilla con barra"),
      A.locations[1],
      null,
    );
    const types = r.map((x) => x.equipment_type).sort();
    expect(types).toEqual(["kettlebell", "leg_press", "none"]);
    const extra = await newAsset(A, 0, "leg_press");
    const same = await subs(
      A,
      "member",
      await exerciseId("Prensa de piernas"),
      A.locations[0],
      await assetId("A1-LP-01"),
    );
    expect(same.find((x) => x.same_exercise)?.asset_id).toBe(extra);
    await t.admin.query("UPDATE app.asset SET status = 'maintenance' WHERE id = $1", [extra]);
  });

  it("the other organisation gets nothing", async () => {
    const { A, B } = t.fx;
    const r = await subs(
      B,
      "owner",
      await exerciseId("Sentadilla con barra"),
      A.locations[0],
      null,
    );
    expect(r).toEqual([]);
  });
});

describe("issues: report, confirm, resolve", () => {
  it("a confirmed out-of-service report takes the asset out of service, audited", async () => {
    const A = t.fx.A;
    const asset = await newAsset(A, 0);
    const issue = await report(A, "member", asset, "out_of_service");
    expect(await report(A, "member", asset, "out_of_service")).toBe(issue); // idempotent repeat tap
    expect(await assetStatus(asset)).toBe("ok"); // a report alone changes nothing
    const status = await asCaller(t.api, as(A, "front_desk"), async (tx) => {
      const r = await tx.query("SELECT app.confirm_asset_issue($1) AS s", [issue]);
      return r.rows[0].s;
    });
    expect(status).toBe("out_of_service");
    expect(await assetStatus(asset)).toBe("out_of_service");
    const audit = await t.admin.query(
      "SELECT action, actor_person_id, actor_role FROM app.audit_log WHERE entity_id IN ($1, $2) ORDER BY id",
      [asset, issue],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "asset_issue.report",
      "asset.status",
      "asset_issue.confirm",
    ]);
    expect(audit.rows[2]).toMatchObject({
      actor_person_id: A.people.front_desk,
      actor_role: "front_desk",
    });

    // Confirming twice fails; front desk cannot resolve; a trainer resolves and restores service.
    await expect(
      asCaller(t.api, as(A, "front_desk"), (tx) =>
        tx.query("SELECT app.confirm_asset_issue($1)", [issue]),
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      asCaller(t.api, as(A, "front_desk"), (tx) =>
        tx.query("SELECT app.resolve_asset_issue($1, true)", [issue]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await asCaller(t.api, as(A, "trainer"), (tx) =>
      tx.query("SELECT app.resolve_asset_issue($1, true)", [issue]),
    );
    expect(await assetStatus(asset)).toBe("ok");
  });

  it.each(["chef", "accountant", "clinician", "nutritionist", "member", "guardian"] as Role[])(
    "%s cannot confirm an issue",
    async (role) => {
      const A = t.fx.A;
      const issue = await report(A, "trainer", await newAsset(A, 0), "out_of_service");
      await expect(
        asCaller(t.api, as(A, role), (tx) =>
          tx.query("SELECT app.confirm_asset_issue($1)", [issue]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    },
  );

  it("staff of another location and the other organisation cannot confirm", async () => {
    const { A, B } = t.fx;
    const asset = await newAsset(A, 1);
    const issue = await report(A, "member", asset, "out_of_service");
    for (const [org, role] of [
      [A, "front_desk"],
      [A, "trainer"],
      [B, "owner"],
    ] as Array<[OrgFixture, Role]>) {
      await expect(
        asCaller(t.api, as(org, role), (tx) =>
          tx.query("SELECT app.confirm_asset_issue($1)", [issue]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect(await assetStatus(asset)).toBe("ok");
    // Other-org members cannot report on A's equipment either.
    await expect(report(B, "member", asset, "busy")).rejects.toMatchObject({ code: "42501" });
    // Location-scoped staff cannot report at a location they do not work.
    await expect(report(A, "front_desk", asset, "busy")).rejects.toMatchObject({ code: "42501" });
    await expect(report(A, "chef", await newAsset(A, 0), "busy")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("a busy report is a short-lived signal: no status change, no audit, not confirmable", async () => {
    const A = t.fx.A;
    const asset = await newAsset(A, 1);
    const issue = await report(A, "member", asset, "busy");
    const row = await t.admin.query(
      "SELECT expires_at - reported_at AS ttl, status FROM app.asset_issue WHERE id = $1",
      [issue],
    );
    expect(row.rows[0].status).toBe("reported");
    expect(row.rows[0].ttl.minutes).toBe(15);
    expect(await assetStatus(asset)).toBe("ok");
    const audit = await t.admin.query("SELECT 1 FROM app.audit_log WHERE entity_id = $1", [issue]);
    expect(audit.rowCount).toBe(0);
    await expect(
      asCaller(t.api, as(A, "owner"), (tx) =>
        tx.query("SELECT app.confirm_asset_issue($1)", [issue]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    // Old busy signals are purged on the next report (never kept as occupancy history).
    await t.admin.query(
      "UPDATE app.asset_issue SET reported_at = now() - interval '2 days', expires_at = now() - interval '2 days' WHERE id = $1",
      [issue],
    );
    await report(A, "member", await newAsset(A, 1), "busy");
    expect(
      (await t.admin.query("SELECT 1 FROM app.asset_issue WHERE id = $1", [issue])).rowCount,
    ).toBe(0);
  });

  it("members see only their own reports; the location's floor staff see the queue", async () => {
    const A = t.fx.A;
    const asset = await newAsset(A, 0);
    const mine = await report(A, "member", asset, "out_of_service", member2A);
    const visible = (role: Role, person?: string) =>
      asCaller(t.api, as(A, role, person), async (tx) =>
        ids((await tx.query("SELECT id FROM app.asset_issue")).rows),
      );
    expect(await visible("member", member2A)).toEqual([mine]);
    expect(await visible("member")).not.toContain(mine);
    expect(await visible("front_desk")).toContain(mine);
    expect(await visible("chef")).toEqual([]);
    expect(await visible("accountant")).toEqual([]);
  });

  it("two simultaneous confirmations: exactly one wins, the other waits and is refused", async () => {
    const A = t.fx.A;
    const asset = await newAsset(A, 0);
    const issue = await report(A, "member", asset, "out_of_service");
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, as(A, "front_desk"));
      await c1.query("SELECT app.confirm_asset_issue($1)", [issue]);
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, as(A, "trainer"));
      const second = c2.query("SELECT app.confirm_asset_issue($1)", [issue]).then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
      await new Promise((r) => setTimeout(r, 100));
      await c1.query("COMMIT");
      expect(await second).toBe("55000");
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    const confirms = await t.admin.query(
      "SELECT 1 FROM app.audit_log WHERE action = 'asset_issue.confirm' AND entity_id = $1",
      [issue],
    );
    expect(confirms.rowCount).toBe(1);
  });

  it("issues cannot be written directly", async () => {
    const A = t.fx.A;
    const bar = await assetId("A1-BAR-01");
    await expect(
      asCaller(t.api, as(A, "owner"), (tx) =>
        tx.query("UPDATE app.asset_issue SET status = 'resolved'"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asCaller(t.api, as(A, "member"), (tx) =>
        tx.query(
          "INSERT INTO app.asset_issue (location_id, asset_id, reported_by, kind) VALUES ($1, $2, $3, 'busy')",
          [A.locations[0], bar, A.people.owner],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("privileges", () => {
  it("no floor function is executable by PUBLIC; definer functions are owned by app_definer", async () => {
    const r = await t.admin.query(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
              EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname IN ('asset_audit_trigger', 'floor_my_member_id',
          'report_asset_issue', 'confirm_asset_issue', 'resolve_asset_issue', 'start_circuit_run',
          'finish_circuit_run', 'log_set', 'substitute_exercise')`,
    );
    expect(r.rowCount).toBe(9);
    for (const f of r.rows) {
      expect(f.public_exec, f.proname).toBe(false);
      if (f.prosecdef) expect(f.owner, f.proname).toBe("app_definer");
    }
  });
});

describe("equipment, library and circuits: writes", () => {
  const insertAsset = (tx: Tx, loc: string, code: string) =>
    tx.query(
      "INSERT INTO app.asset (location_id, equipment_type, station_code) VALUES ($1, 'bench', $2) RETURNING id",
      [loc, code],
    );

  it("owner, location_manager and trainer add equipment at their locations", async () => {
    const A = t.fx.A;
    for (const role of ["owner", "location_manager", "trainer"] as Role[]) {
      const r = await asCaller(t.api, as(A, role), (tx) =>
        insertAsset(tx, A.locations[0], `W-${role.slice(0, 5).toUpperCase()}`),
      );
      expect(r.rowCount, role).toBe(1);
    }
  });

  it.each(["front_desk", "chef", "accountant", "clinician", "member", "guardian"] as Role[])(
    "%s cannot add equipment",
    async (role) => {
      await expect(
        asCaller(t.api, as(t.fx.A, role), (tx) => insertAsset(tx, t.fx.A.locations[0], "W-DENY")),
      ).rejects.toMatchObject({ code: "42501" });
    },
  );

  it("scoped managers cannot add or edit equipment at another location", async () => {
    const A = t.fx.A;
    await expect(
      asCaller(t.api, as(A, "trainer"), (tx) => insertAsset(tx, A.locations[1], "W-OTHER")),
    ).rejects.toMatchObject({ code: "42501" });
    // Without RETURNING (so the SELECT policy is not what refuses it): the INSERT policy's location scope.
    await expect(
      asCaller(t.api, as(A, "location_manager"), (tx) =>
        tx.query(
          "INSERT INTO app.asset (location_id, equipment_type, station_code) VALUES ($1, 'bench', 'W-OTHER2')",
          [A.locations[1]],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const other = await assetId("A2-KB-01");
    const upd = await asCaller(t.api, as(A, "location_manager"), (tx) =>
      tx.query("UPDATE app.asset SET status = 'maintenance' WHERE id = $1", [other]),
    );
    expect(upd.rowCount).toBe(0);
    expect(await assetStatus(other)).toBe("ok");
  });

  it("forbidden columns cannot be written", async () => {
    const A = t.fx.A;
    const asset = await assetId("A1-BAR-01");
    for (const sql of [
      "UPDATE app.asset SET location_id = location_id WHERE id = $1",
      "UPDATE app.asset SET org_id = org_id WHERE id = $1",
      "UPDATE app.circuit SET location_id = location_id WHERE id = $1",
      "UPDATE app.circuit_run SET member_id = member_id WHERE id = $1",
    ]) {
      await expect(
        asCaller(t.api, as(A, "owner"), (tx) => tx.query(sql, [asset])),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("a status change made directly is audited with the real actor", async () => {
    const A = t.fx.A;
    const asset = await newAsset(A, 0);
    await asCaller(t.api, as(A, "trainer"), (tx) =>
      tx.query("UPDATE app.asset SET status = 'maintenance' WHERE id = $1", [asset]),
    );
    const a = await t.admin.query(
      "SELECT actor_person_id, meta FROM app.audit_log WHERE action = 'asset.status' AND entity_id = $1",
      [asset],
    );
    expect(a.rows[0]).toMatchObject({
      actor_person_id: A.people.trainer,
      meta: { from: "ok", to: "maintenance" },
    });
  });

  it("hostile input is refused by the schema", async () => {
    const A = t.fx.A;
    for (const code of [
      "a1-low",
      "A1 BAR",
      "HTTPS://EVIL.INVALID",
      "A1-BAR-01\n",
      "{{X}}",
      "ÄBC",
    ]) {
      await expect(
        asCaller(t.api, as(A, "owner"), (tx) => insertAsset(tx, A.locations[0], code)),
        code,
      ).rejects.toMatchObject({ code: "23514" });
    }
    for (const [name, cues] of [
      ["<script>x</script>", ""],
      ["Prеss", ""], // Cyrillic "е" (homoglyph)
      ["Press nuevo", "{{brand}} gratis"],
      ["Press nuevo 2", "<b>x</b>"],
      ["Press nuevo 3", "a\u0007b"],
    ]) {
      await expect(
        asCaller(t.api, as(A, "trainer"), (tx) =>
          tx.query(
            "INSERT INTO app.exercise (name, movement_pattern, equipment_type, cues) VALUES ($1, 'core', 'none', $2)",
            [name, cues],
          ),
        ),
        name,
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      asCaller(t.api, as(A, "trainer"), (tx) =>
        tx.query(
          "INSERT INTO app.asset (location_id, equipment_type, station_code) VALUES ($1, 'none', 'NONE-1')",
          [A.locations[0]],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("station codes are unique per organisation, not across organisations", async () => {
    const { A, B } = t.fx;
    await expect(
      asCaller(t.api, as(A, "owner"), (tx) => insertAsset(tx, A.locations[1], "A1-BAR-01")),
    ).rejects.toMatchObject({ code: "23505" });
    const r = await asCaller(t.api, as(B, "owner"), (tx) =>
      insertAsset(tx, B.locations[0], "A1-BAR-01"),
    );
    expect(r.rowCount).toBe(1);
  });

  it("a circuit step cannot use equipment from another location, and needs asset XOR type", async () => {
    const A = t.fx.A;
    const circuit = (
      await t.admin.query(
        "SELECT id FROM app.circuit WHERE org_id = $1 AND location_id = $2 LIMIT 1",
        [A.orgId, A.locations[0]],
      )
    ).rows[0].id;
    const ex = await exerciseId("Sentadilla goblet");
    const stepEx = (tx: Tx, loc: string, asset: string | null, type: string | null) =>
      tx.query(
        `INSERT INTO app.circuit_step (circuit_id, location_id, position, exercise_id, asset_id, equipment_type, sets, reps)
         VALUES ($1, $2, 40, $3, $4, $5, 3, 10)`,
        [circuit, loc, ex, asset, type],
      );
    // Asset at location 2 in a location-1 circuit → FK violation.
    const kb2 = await assetId("A2-KB-01");
    await expect(
      asCaller(t.api, as(A, "owner"), (tx) => stepEx(tx, A.locations[0], kb2, null)),
    ).rejects.toMatchObject({ code: "23503" });
    // Claiming the step is at location 2 does not help: the circuit is at location 1.
    await expect(
      asCaller(t.api, as(A, "owner"), (tx) => stepEx(tx, A.locations[1], kb2, null)),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      asCaller(t.api, as(A, "owner"), async (tx) =>
        stepEx(tx, A.locations[0], await assetId("A1-BAR-01"), "barbell"),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // A trainer cannot write steps for a circuit at another location.
    await expect(
      asCaller(t.api, as(A, "trainer"), (tx) => stepEx(tx, A.locations[1], null, "kettlebell")),
    ).rejects.toMatchObject({ code: "42501" });
    const ok = await asCaller(t.api, as(A, "trainer"), (tx) =>
      stepEx(tx, A.locations[0], null, "kettlebell"),
    );
    expect(ok.rowCount).toBe(1);
  });

  it("the exercise library is curated by managers and trainers only", async () => {
    const A = t.fx.A;
    for (const role of ["front_desk", "member", "chef"] as Role[]) {
      await expect(
        asCaller(t.api, as(A, role), (tx) =>
          tx.query(
            "INSERT INTO app.exercise (name, movement_pattern, equipment_type) VALUES ($1, 'core', 'none')",
            [`Plancha ${role}`],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    const r = await asCaller(t.api, as(A, "trainer"), (tx) =>
      tx.query(
        "INSERT INTO app.exercise (name, movement_pattern, equipment_type, cues) VALUES ('Plancha frontal', 'core', 'none', $1)",
        ["Codos bajo hombros.\nAbdomen firme."],
      ),
    );
    expect(r.rowCount).toBe(1);
  });
});

describe("circuit runs and set logging", () => {
  const circuitA = async () =>
    (
      await t.admin.query(
        "SELECT id FROM app.circuit WHERE org_id = $1 AND name = 'Circuito Fuerza A'",
        [t.fx.A.orgId],
      )
    ).rows[0].id as string;
  const start = (claims: ReturnType<typeof as>, circuit: string) =>
    asCaller(t.api, claims, async (tx) => {
      const r = await tx.query("SELECT app.start_circuit_run($1) AS id", [circuit]);
      return r.rows[0].id as string;
    });

  it("a member runs a circuit, logs sets, and finishes; a finished run takes no more sets", async () => {
    const A = t.fx.A;
    const circuit = await circuitA();
    const run = await start(as(A, "member"), circuit);
    expect(await start(as(A, "member"), circuit)).toBe(run); // resume, not a second run
    const squat = await exerciseId("Sentadilla con barra");
    const bar = await assetId("A1-BAR-01");
    const setId = await asCaller(t.api, as(A, "member"), async (tx) => {
      const r = await tx.query("SELECT app.log_set($1, $2, $3, $4, 8, 62.5) AS id", [
        squat,
        A.locations[0],
        bar,
        run,
      ]);
      return r.rows[0].id;
    });
    const row = await t.admin.query(
      "SELECT member_id, weight_kg, circuit_run_id FROM app.set_log WHERE id = $1",
      [setId],
    );
    expect(row.rows[0]).toEqual({
      member_id: A.members[0],
      weight_kg: "62.50",
      circuit_run_id: run,
    });
    await asCaller(t.api, as(A, "member"), (tx) =>
      tx.query("SELECT app.finish_circuit_run($1)", [run]),
    );
    await expect(
      asCaller(t.api, as(A, "member"), (tx) =>
        tx.query("SELECT app.log_set($1, $2, $3, $4, 8, 60)", [squat, A.locations[0], bar, run]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a member cannot log against another member's run or with equipment from another location", async () => {
    const A = t.fx.A;
    const circuit = await circuitA();
    const othersRun = await start(as(A, "member", member2A), circuit);
    const squat = await exerciseId("Sentadilla con barra");
    await expect(
      asCaller(t.api, as(A, "member"), (tx) =>
        tx.query("SELECT app.log_set($1, $2, NULL, $3, 8, 60)", [squat, A.locations[0], othersRun]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asCaller(t.api, as(A, "member"), async (tx) =>
        tx.query("SELECT app.log_set($1, $2, $3, NULL, 8, 60)", [
          squat,
          A.locations[0],
          await assetId("A2-KB-01"),
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Members may train at any location of their org.
    const ok = await asCaller(t.api, as(A, "member"), async (tx) =>
      tx.query("SELECT app.log_set($1, $2, $3, NULL, 12, 16)", [
        await exerciseId("Sentadilla goblet"),
        A.locations[1],
        await assetId("A2-KB-01"),
      ]),
    );
    expect(ok.rowCount).toBe(1);
  });

  it.each(["trainer", "owner", "front_desk", "guardian"] as Role[])(
    "%s cannot start runs or log sets (members only)",
    async (role) => {
      const A = t.fx.A;
      await expect(start(as(A, role), await circuitA())).rejects.toMatchObject({ code: "42501" });
      await expect(
        asCaller(t.api, as(A, role), async (tx) =>
          tx.query("SELECT app.log_set($1, $2, NULL, NULL, 8, 60)", [
            await exerciseId("Flexiones"),
            A.locations[0],
          ]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    },
  );

  it("hostile numbers are refused", async () => {
    const A = t.fx.A;
    for (const [reps, kg] of [
      [-1, 10],
      [5, -2],
      [5, 5000],
      [2000, 10],
    ]) {
      await expect(
        asCaller(t.api, as(A, "member"), async (tx) =>
          tx.query("SELECT app.log_set($1, $2, NULL, NULL, $3, $4)", [
            await exerciseId("Flexiones"),
            A.locations[0],
            reps,
            kg,
          ]),
        ),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^(23514|22003)$/) });
    }
  });

  it("an inactive or other-org circuit cannot be started", async () => {
    const { A, B } = t.fx;
    const inactive = (
      await t.admin.query(
        "INSERT INTO app.circuit (org_id, location_id, name, active) VALUES ($1, $2, 'Demo pausado', false) RETURNING id",
        [A.orgId, A.locations[0]],
      )
    ).rows[0].id;
    await expect(start(as(A, "member"), inactive)).rejects.toMatchObject({ code: "42501" });
    await expect(start(as(B, "member"), await circuitA())).rejects.toMatchObject({ code: "42501" });
  });

  it("two simultaneous starts by the same member open a single run", async () => {
    const A = t.fx.A;
    const circuit = await circuitA();
    // member2 already has an open run from an earlier test; finish it so both starts race from a clean slate.
    await t.admin.query(
      "UPDATE app.circuit_run SET finished_at = now() WHERE member_id = $1 AND finished_at IS NULL",
      [A.members[1]],
    );
    const [r1, r2] = await Promise.all([
      start(as(A, "member", member2A), circuit),
      start(as(A, "member", member2A), circuit),
    ]);
    expect(r1).toBe(r2);
    const open = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.circuit_run WHERE member_id = $1 AND finished_at IS NULL",
      [A.members[1]],
    );
    expect(open.rows[0].n).toBe(1);
  });
});
