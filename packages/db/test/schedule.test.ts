import type { Claims, Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Module schedule (E6): classes, bookings + waitlist, location policy, appointments, check-in with rotating QR.
let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (c: string) => ({ code: c });

/** Expect the statement to be refused with `pgCode`, keeping the transaction usable. */
async function refused(tx: Tx, sql: string, params: unknown[], pgCode: string) {
  await tx.query("SAVEPOINT r");
  await expect(tx.query(sql, params)).rejects.toMatchObject(code(pgCode));
  await tx.query("ROLLBACK TO SAVEPOINT r");
}

let seq = 0;
/** A fresh member of `org` (admin insert), so cases never depend on rows another case mutated. */
async function newMember(org: OrgFixture, loc = org.locations[0], status = "active") {
  seq += 1;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`sched${seq}.${org.orgId.slice(0, 6)}@demo.invalid`],
  );
  const personId = p.rows[0]?.id as string;
  const m = await t.admin.query<{ id: string }>(
    `INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status, member_no)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [org.orgId, personId, loc, `Demo Sched ${seq}`, status, `S-${seq}`],
  );
  const id = m.rows[0]?.id as string;
  const claims: Claims = { ...t.claims(org, "member", personId) };
  return { id, personId, claims };
}

async function classType(org: OrgFixture): Promise<string> {
  const r = await t.admin.query<{ id: string }>(
    "SELECT id FROM app.class_type WHERE org_id = $1 AND name = 'Demo Spinning'",
    [org.orgId],
  );
  return r.rows[0]?.id as string;
}
async function staffId(org: OrgFixture, role: Role): Promise<string> {
  const r = await t.admin.query<{ id: string }>(
    "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = $3",
    [org.orgId, org.people[role], role],
  );
  return r.rows[0]?.id as string;
}

/** A session inserted by the superuser (lets cases build past sessions). `startsIn` is a Postgres interval. */
async function newSession(
  org: OrgFixture,
  opts: { loc?: string; capacity?: number; startsIn?: string; instructor?: string | null } = {},
) {
  const instructor =
    opts.instructor === undefined ? await staffId(org, "trainer") : opts.instructor;
  const r = await t.admin.query<{ id: string }>(
    `INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, starts_at, ends_at, capacity, created_by)
     VALUES ($1, $2, $3, $4, now() + $5::interval, now() + $5::interval + interval '45 minutes', $6, $7) RETURNING id`,
    [
      org.orgId,
      opts.loc ?? org.locations[0],
      await classType(org),
      instructor,
      opts.startsIn ?? "2 days",
      opts.capacity ?? 5,
      org.people.owner,
    ],
  );
  return r.rows[0]?.id as string;
}

async function book(claims: Claims, session: string, member: string): Promise<string> {
  return asCaller(t.api, claims, async (tx) => {
    const r = await tx.query<{ id: string }>("SELECT app.book_class($1, $2) AS id", [
      session,
      member,
    ]);
    return r.rows[0]?.id as string;
  });
}
async function bookingRow(id: string) {
  const r = await t.admin.query(
    "SELECT status, waitlist_position, late_cancel FROM app.booking WHERE id = $1",
    [id],
  );
  return r.rows[0];
}
const fd = () => t.claims(t.fx.A, "front_desk");

describe("access rule (spec §3.2)", () => {
  it.each([
    ["active", false, "allowed", "active"],
    ["trial", false, "allowed", "trial"],
    ["past_due", false, "allowed", "past_due"],
    ["past_due", true, "denied", "past_due_denied"],
    ["active", true, "allowed", "active"],
    ["frozen", false, "denied", "frozen"],
    ["cancelled", false, "denied", "cancelled"],
    ["lead", false, "denied", "lead"],
  ])("%s (deny_past_due=%s) → %s / %s", async (status, deny, result, reason) => {
    const r = await t.admin.query("SELECT * FROM app.access_decision($1, $2)", [status, deny]);
    expect(r.rows[0]).toEqual({ result, reason });
  });

  it("the location policy defaults to NOT denying past_due members (human decision)", async () => {
    const r = await t.admin.query(
      "SELECT column_default FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'location_policy' AND column_name = 'deny_past_due'",
    );
    expect(r.rows[0].column_default).toBe("false");
  });
});

describe("class catalogue", () => {
  it.each(["owner", "location_manager"] as Role[])("%s adds a class type", async (role) => {
    await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
      const r = await tx.query(
        "INSERT INTO app.class_type (name, duration_min, default_capacity) VALUES ($1, 50, 12) RETURNING org_id",
        [`Demo Yoga ${role === "owner" ? "Uno" : "Dos"}`],
      );
      expect(r.rows[0].org_id).toBe(t.fx.A.orgId);
    });
  });

  it.each(["front_desk", "trainer", "chef", "accountant", "member", "guardian"] as Role[])(
    "%s cannot add a class type",
    async (role) => {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        await refused(tx, "INSERT INTO app.class_type (name) VALUES ('Demo Nope')", [], "42501");
      });
    },
  );

  it("org_id is not writable and hostile names are refused", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await refused(
        tx,
        "INSERT INTO app.class_type (org_id, name) VALUES ($1, 'Demo Planted')",
        [t.fx.B.orgId],
        "42501",
      );
      // Column grants, not only RLS: even the caller's own org_id, or a chosen id, is not writable.
      await refused(
        tx,
        "INSERT INTO app.class_type (org_id, name) VALUES ($1, 'Demo Own Org')",
        [t.fx.A.orgId],
        "42501",
      );
      await refused(
        tx,
        "INSERT INTO app.class_type (id, name) VALUES (gen_random_uuid(), 'Demo Chosen Id')",
        [],
        "42501",
      );
      for (const name of [
        "{{brand}} gratis",
        "Visita gymbarato.com",
        "Línea\nnueva",
        "x".repeat(61),
        "<b>Spin</b>",
      ]) {
        await refused(tx, "INSERT INTO app.class_type (name) VALUES ($1)", [name], "23514");
      }
      await refused(tx, "UPDATE app.class_type SET org_id = $1", [t.fx.B.orgId], "42501");
    });
  });
});

describe("sessions", () => {
  const create = (
    tx: Tx,
    loc: string,
    instructor: string | null,
    startsIn = "3 days",
    room = "Salon 2",
  ) =>
    tx.query(
      `SELECT app.create_class_session($1, $2, $3, $4, now() + $5::interval, now() + $5::interval + interval '1 hour', 8) AS id`,
      [loc, ctA, instructor, room, startsIn],
    );
  let ctA = "";
  beforeAll(async () => {
    ctA = await classType(t.fx.A);
  });

  it("location manager creates a session at its location with its trainer; audited", async () => {
    const trainer = await staffId(t.fx.A, "trainer");
    const id = await asCaller(t.api, t.claims(t.fx.A, "location_manager"), async (tx) => {
      const r = await create(tx, t.fx.A.locations[0], trainer, "10 days");
      return r.rows[0].id as string;
    });
    const a = await t.admin.query(
      "SELECT actor_role FROM app.audit_log WHERE action = 'class_session.create' AND entity_id = $1",
      [id],
    );
    expect(a.rows).toEqual([{ actor_role: "location_manager" }]);
  });

  it("owner creates at any location; manager not at another location; other roles never", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) => create(tx, t.fx.A.locations[1], null));
    await asCaller(t.api, t.claims(t.fx.A, "location_manager"), async (tx) => {
      await refused(
        tx,
        "SELECT app.create_class_session($1, $2, NULL, NULL, now() + interval '1 day', now() + interval '25 hours', 5)",
        [t.fx.A.locations[1], ctA],
        "42501",
      );
    });
    for (const role of [
      "front_desk",
      "trainer",
      "chef",
      "accountant",
      "member",
      "guardian",
    ] as Role[]) {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        await refused(
          tx,
          "SELECT app.create_class_session($1, $2, NULL, NULL, now() + interval '1 day', now() + interval '25 hours', 5)",
          [t.fx.A.locations[0], ctA],
          "42501",
        );
      });
    }
    // Another org's location (or class type) is refused the same way.
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await refused(
        tx,
        "SELECT app.create_class_session($1, $2, NULL, NULL, now() + interval '1 day', now() + interval '25 hours', 5)",
        [t.fx.B.locations[0], ctA],
        "42501",
      );
      await refused(
        tx,
        "SELECT app.create_class_session($1, $2, NULL, NULL, now() + interval '1 day', now() + interval '25 hours', 5)",
        [t.fx.A.locations[0], await classType(t.fx.B)],
        "22023",
      );
    });
  });

  it("refuses non-trainer instructors, past start times, hostile rooms and bad capacities", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      const chef = await staffId(t.fx.A, "chef");
      const trainerB = await staffId(t.fx.B, "trainer");
      await refused(
        tx,
        "SELECT app.create_class_session($1, $2, $3, NULL, now() + interval '5 days', now() + interval '5 days 1 hour', 5)",
        [t.fx.A.locations[0], ctA, chef],
        "22023",
      );
      await refused(
        tx,
        "SELECT app.create_class_session($1, $2, $3, NULL, now() + interval '5 days', now() + interval '5 days 1 hour', 5)",
        [t.fx.A.locations[0], ctA, trainerB],
        "22023",
      );
      // The trainer is assigned to locations[0] only.
      await refused(
        tx,
        "SELECT app.create_class_session($1, $2, $3, NULL, now() + interval '5 days', now() + interval '5 days 1 hour', 5)",
        [t.fx.A.locations[1], ctA, await staffId(t.fx.A, "trainer")],
        "22023",
      );
      await refused(
        tx,
        "SELECT app.create_class_session($1, $2, NULL, NULL, now() - interval '1 hour', now(), 5)",
        [t.fx.A.locations[0], ctA],
        "22023",
      );
      for (const room of ["Sala\n2", "{{x}}", "visita.example"]) {
        await refused(
          tx,
          "SELECT app.create_class_session($1, $2, NULL, $3, now() + interval '5 days', now() + interval '5 days 1 hour', 5)",
          [t.fx.A.locations[0], ctA, room],
          "23514",
        );
      }
      for (const cap of [0, 501]) {
        await refused(
          tx,
          "SELECT app.create_class_session($1, $2, NULL, NULL, now() + interval '5 days', now() + interval '5 days 1 hour', $3)",
          [t.fx.A.locations[0], ctA, cap],
          "23514",
        );
      }
    });
  });

  it("a trainer cannot be double-booked: a class overlapping one they teach is refused", async () => {
    const trainer = await staffId(t.fx.A, "trainer");
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await create(tx, t.fx.A.locations[0], trainer, "20 days");
      await refused(
        tx,
        `SELECT app.create_class_session($1, $2, $3, NULL, now() + interval '20 days 30 minutes', now() + interval '20 days 90 minutes', 5)`,
        [t.fx.A.locations[0], ctA, trainer],
        "23505",
      );
    });
  });

  it("another org's sessions are invisible and cannot be booked or cancelled", async () => {
    const sB = await newSession(t.fx.B);
    for (const role of [
      "owner",
      "front_desk",
      "trainer",
      "member",
      "guardian",
      "accountant",
    ] as Role[]) {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        const r = await tx.query("SELECT 1 FROM app.class_session WHERE id = $1", [sB]);
        expect(r.rowCount, role).toBe(0);
        const occ = await tx.query("SELECT * FROM app.session_occupancy($1)", [[sB]]);
        expect(occ.rowCount, role).toBe(0);
        await refused(tx, "SELECT app.book_class($1, $2)", [sB, t.fx.A.members[0]], "42501");
        await refused(tx, "SELECT app.session_roster($1)", [sB], "42501");
        await refused(tx, "SELECT app.cancel_class_session($1)", [sB], "42501");
      });
    }
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.booking WHERE session_id = $1",
      [sB],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("scoped staff see their locations' sessions; members see every session of their org", async () => {
    await asCaller(t.api, fd(), async (tx) => {
      const r = await tx.query("SELECT DISTINCT location_id FROM app.class_session");
      expect(r.rows.map((x) => x.location_id)).toEqual([t.fx.A.locations[0]]);
    });
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      const r = await tx.query("SELECT DISTINCT location_id FROM app.class_session ORDER BY 1");
      expect(r.rowCount).toBe(2);
    });
  });

  it("cancelling a session cancels its live bookings (owner/manager only)", async () => {
    const s = await newSession(t.fx.A);
    const m = await newMember(t.fx.A);
    const b = await book(fd(), s, m.id);
    await asCaller(t.api, fd(), async (tx) => {
      await refused(tx, "SELECT app.cancel_class_session($1)", [s], "42501");
    });
    await asCaller(t.api, t.claims(t.fx.A, "location_manager"), (tx) =>
      tx.query("SELECT app.cancel_class_session($1)", [s]),
    );
    expect(await bookingRow(b)).toMatchObject({ status: "cancelled", late_cancel: false });
    await expect(book(fd(), s, (await newMember(t.fx.A)).id)).rejects.toMatchObject(code("22023"));
  });
});

describe("bookings", () => {
  it("a member books themself; a second booking of the same class is a conflict", async () => {
    const s = await newSession(t.fx.A);
    const m = await newMember(t.fx.A);
    const id = await book(m.claims, s, m.id);
    expect(await bookingRow(id)).toMatchObject({ status: "booked", waitlist_position: null });
    await expect(book(m.claims, s, m.id)).rejects.toMatchObject(code("23505"));
    const a = await t.admin.query(
      "SELECT actor_role, meta->>'status' AS status FROM app.audit_log WHERE action = 'booking.create' AND entity_id = $1",
      [id],
    );
    expect(a.rows).toEqual([{ actor_role: "member", status: "booked" }]);
  });

  it("a member cannot book someone else; a guardian books only the ward", async () => {
    const s = await newSession(t.fx.A);
    const other = await newMember(t.fx.A);
    await expect(book(t.claims(t.fx.A, "member"), s, other.id)).rejects.toMatchObject(
      code("42501"),
    );
    await expect(book(t.claims(t.fx.A, "guardian"), s, other.id)).rejects.toMatchObject(
      code("42501"),
    );
    const ward = await t.admin.query<{ member_id: string }>(
      "SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1",
      [t.fx.A.people.guardian],
    );
    const id = await book(t.claims(t.fx.A, "guardian"), s, ward.rows[0]?.member_id as string);
    expect((await bookingRow(id)).status).toBe("booked");
  });

  it("front of house books at its locations only; other staff roles never book", async () => {
    const s0 = await newSession(t.fx.A);
    const s1 = await newSession(t.fx.A, { loc: t.fx.A.locations[1], instructor: null });
    const m = await newMember(t.fx.A);
    await book(fd(), s0, m.id);
    await expect(book(fd(), s1, m.id)).rejects.toMatchObject(code("42501"));
    await book(t.claims(t.fx.A, "owner"), s1, m.id);
    for (const role of ["trainer", "nutritionist", "chef", "clinician", "accountant"] as Role[]) {
      await expect(
        book(t.claims(t.fx.A, role), s0, (await newMember(t.fx.A)).id),
        role,
      ).rejects.toMatchObject(code("42501"));
    }
  });

  it("frozen, cancelled and lead members cannot book; past_due can unless the location denies it", async () => {
    const s = await newSession(t.fx.A);
    for (const status of ["frozen", "cancelled", "lead"]) {
      const m = await newMember(t.fx.A, t.fx.A.locations[0], status);
      await expect(book(fd(), s, m.id), status).rejects.toMatchObject(code("42501"));
    }
    const pd = await newMember(t.fx.A, t.fx.A.locations[0], "past_due");
    expect((await bookingRow(await book(fd(), s, pd.id))).status).toBe("booked");
  });

  it("capacity is enforced; extra bookings join the waitlist in order", async () => {
    const s = await newSession(t.fx.A, { capacity: 1 });
    const [a, b, c] = [await newMember(t.fx.A), await newMember(t.fx.A), await newMember(t.fx.A)];
    const ba = await book(fd(), s, a.id);
    const bb = await book(fd(), s, b.id);
    const bc = await book(fd(), s, c.id);
    expect(await bookingRow(ba)).toMatchObject({ status: "booked", waitlist_position: null });
    expect(await bookingRow(bb)).toMatchObject({ status: "waitlisted", waitlist_position: 1 });
    expect(await bookingRow(bc)).toMatchObject({ status: "waitlisted", waitlist_position: 2 });
    const occ = await asCaller(t.api, a.claims, (tx) =>
      tx.query("SELECT booked, waitlisted FROM app.session_occupancy($1)", [[s]]),
    );
    expect(occ.rows[0]).toEqual({ booked: 1, waitlisted: 2 });
  });

  it("cancelling a booked seat promotes the first waitlisted booking and renumbers the rest", async () => {
    const s = await newSession(t.fx.A, { capacity: 1 });
    const [a, b, c] = [await newMember(t.fx.A), await newMember(t.fx.A), await newMember(t.fx.A)];
    const ba = await book(fd(), s, a.id);
    const bb = await book(fd(), s, b.id);
    const bc = await book(fd(), s, c.id);
    const r = await asCaller(t.api, a.claims, (tx) =>
      tx.query("SELECT * FROM app.cancel_booking($1)", [ba]),
    );
    expect(r.rows[0]).toEqual({ status: "cancelled", late_cancel: false, promoted_booking_id: bb });
    expect(await bookingRow(ba)).toMatchObject({ status: "cancelled", late_cancel: false });
    expect(await bookingRow(bb)).toMatchObject({ status: "booked", waitlist_position: null });
    expect(await bookingRow(bc)).toMatchObject({ status: "waitlisted", waitlist_position: 1 });
    const audit = await t.admin.query(
      "SELECT actor_role FROM app.audit_log WHERE action = 'booking.promote' AND entity_id = $1",
      [bb],
    );
    expect(audit.rows).toEqual([{ actor_role: "member" }]);
  });

  it("cancelling inside the location's window is flagged late; outside it is not; waitlist cancels never are", async () => {
    // locations[0] policy: 12 h window (fixture).
    const soon = await newSession(t.fx.A, { startsIn: "2 hours", capacity: 1 });
    const later = await newSession(t.fx.A, { startsIn: "2 days" });
    const m = await newMember(t.fx.A);
    const w = await newMember(t.fx.A);
    const b1 = await book(m.claims, soon, m.id);
    const bw = await book(w.claims, soon, w.id);
    const b2 = await book(m.claims, later, m.id);
    await asCaller(t.api, w.claims, (tx) => tx.query("SELECT app.cancel_booking($1)", [bw]));
    await asCaller(t.api, m.claims, async (tx) => {
      await tx.query("SELECT app.cancel_booking($1)", [b1]);
      await tx.query("SELECT app.cancel_booking($1)", [b2]);
    });
    expect((await bookingRow(b1)).late_cancel).toBe(true);
    expect((await bookingRow(b2)).late_cancel).toBe(false);
    expect((await bookingRow(bw)).late_cancel).toBe(false);
    await expect(
      asCaller(t.api, m.claims, (tx) => tx.query("SELECT app.cancel_booking($1)", [b1])),
    ).rejects.toMatchObject(code("22023"));
  });

  it("only the member, their guardian or front of house of the location cancels a booking", async () => {
    const s = await newSession(t.fx.A);
    const m = await newMember(t.fx.A);
    const b = await book(m.claims, s, m.id);
    for (const claims of [
      t.claims(t.fx.A, "member"),
      t.claims(t.fx.A, "guardian"),
      t.claims(t.fx.A, "trainer"),
      t.claims(t.fx.A, "chef"),
      t.claims(t.fx.B, "owner"),
    ]) {
      await expect(
        asCaller(t.api, claims, (tx) => tx.query("SELECT app.cancel_booking($1)", [b])),
        claims.app_role,
      ).rejects.toMatchObject(code("42501"));
    }
    expect((await bookingRow(b)).status).toBe("booked");
  });

  it("CONCURRENCY: two bookings for the last seat → exactly one booked, the other waitlisted", async () => {
    const s = await newSession(t.fx.A, { capacity: 1 });
    const [a, b] = [await newMember(t.fx.A), await newMember(t.fx.A)];
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, fd());
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, fd());
      await c1.query("SELECT app.book_class($1, $2)", [s, a.id]);
      let settled = false;
      const second = c2.query("SELECT app.book_class($1, $2)", [s, b.id]).finally(() => {
        settled = true;
      });
      await sleep(300);
      expect(settled, "the second booking must wait for the session lock").toBe(false);
      await c1.query("COMMIT");
      await second;
      await c2.query("COMMIT");
    } finally {
      await c1.query("ROLLBACK").catch(() => undefined);
      await c2.query("ROLLBACK").catch(() => undefined);
      c1.release();
      c2.release();
    }
    const r = await t.admin.query(
      "SELECT status, count(*)::int AS n FROM app.booking WHERE session_id = $1 GROUP BY status ORDER BY status",
      [s],
    );
    expect(r.rows).toEqual([
      { status: "booked", n: 1 },
      { status: "waitlisted", n: 1 },
    ]);
  });

  it("bookings cannot be written directly (no grants): status, member or org", async () => {
    const s = await newSession(t.fx.A);
    const m = await newMember(t.fx.A);
    const b = await book(m.claims, s, m.id);
    for (const claims of [m.claims, fd(), t.claims(t.fx.A, "owner")]) {
      await asCaller(t.api, claims, async (tx) => {
        await refused(tx, "UPDATE app.booking SET status = 'attended' WHERE id = $1", [b], "42501");
        await refused(
          tx,
          "UPDATE app.booking SET member_id = $2 WHERE id = $1",
          [b, t.fx.A.members[1]],
          "42501",
        );
        await refused(
          tx,
          "INSERT INTO app.booking (session_id, member_id, status, booked_by) VALUES ($1, $2, 'booked', $2)",
          [s, t.fx.A.members[1]],
          "42501",
        );
        await refused(tx, "DELETE FROM app.booking WHERE id = $1", [b], "42501");
      });
    }
  });

  it("visibility: members see their own bookings, trainers only their own sessions, chef/accountant none", async () => {
    const mine = await newSession(t.fx.A);
    const other = await newSession(t.fx.A, { instructor: null });
    const m = await newMember(t.fx.A);
    const b1 = await book(m.claims, mine, m.id);
    const b2 = await book(m.claims, other, m.id);
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      const r = await tx.query("SELECT DISTINCT member_id FROM app.booking");
      expect(r.rows.map((x) => x.member_id)).toEqual([t.fx.A.members[0]]);
    });
    await asCaller(t.api, t.claims(t.fx.A, "trainer"), async (tx) => {
      const r = await tx.query("SELECT id FROM app.booking WHERE id = ANY($1)", [[b1, b2]]);
      expect(r.rows.map((x) => x.id)).toEqual([b1]);
      const roster = await tx.query("SELECT full_name FROM app.session_roster($1)", [mine]);
      expect(roster.rows.map((x) => x.full_name)).toContain(
        (await t.admin.query("SELECT full_name FROM app.member WHERE id = $1", [m.id])).rows[0]
          .full_name,
      );
      await refused(tx, "SELECT * FROM app.session_roster($1)", [other], "42501");
    });
    for (const role of ["chef", "accountant", "nutritionist", "clinician"] as Role[]) {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.booking")).rowCount, role).toBe(0);
        await refused(tx, "SELECT * FROM app.session_roster($1)", [mine], "42501");
      });
    }
  });
});

describe("attendance", () => {
  it("the session's trainer and front desk mark attendance; another trainer and members cannot", async () => {
    const s = await newSession(t.fx.A, { startsIn: "-10 minutes" });
    const [a, b] = [await newMember(t.fx.A), await newMember(t.fx.A)];
    const ins = async (m: string) =>
      (
        await t.admin.query<{ id: string }>(
          "INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by) VALUES ($1,$2,$3,'booked',$4) RETURNING id",
          [t.fx.A.orgId, s, m, t.fx.A.people.front_desk],
        )
      ).rows[0]?.id as string;
    const [ba, bb] = [await ins(a.id), await ins(b.id)];
    await asCaller(t.api, t.claims(t.fx.A, "trainer"), (tx) =>
      tx.query("SELECT app.mark_attendance($1, 'attended')", [ba]),
    );
    await asCaller(t.api, fd(), (tx) =>
      tx.query("SELECT app.mark_attendance($1, 'no_show')", [bb]),
    );
    expect((await bookingRow(ba)).status).toBe("attended");
    expect((await bookingRow(bb)).status).toBe("no_show");

    // A second trainer at the same location who does not teach this class.
    const p = await t.admin.query<{ id: string }>(
      "INSERT INTO app.person (email) VALUES ('coach2.sched@demo.invalid') RETURNING id",
    );
    const sm = await t.admin.query<{ id: string }>(
      "INSERT INTO app.staff_member (org_id, person_id, role, display_name) VALUES ($1,$2,'trainer','Demo Coach Two') RETURNING id",
      [t.fx.A.orgId, p.rows[0]?.id],
    );
    await t.admin.query(
      "INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES ($1,$2,$3)",
      [t.fx.A.orgId, sm.rows[0]?.id, t.fx.A.locations[0]],
    );
    for (const claims of [
      t.claims(t.fx.A, "trainer", p.rows[0]?.id),
      a.claims,
      t.claims(t.fx.A, "chef"),
      t.claims(t.fx.B, "owner"),
    ]) {
      await expect(
        asCaller(t.api, claims, (tx) =>
          tx.query("SELECT app.mark_attendance($1, 'no_show')", [ba]),
        ),
      ).rejects.toMatchObject(code("42501"));
    }
    expect((await bookingRow(ba)).status).toBe("attended");
  });

  it("attendance is refused long before the class and for non-attendance statuses", async () => {
    const s = await newSession(t.fx.A, { startsIn: "1 day" });
    const m = await newMember(t.fx.A);
    const b = await book(fd(), s, m.id);
    await asCaller(t.api, fd(), async (tx) => {
      await refused(tx, "SELECT app.mark_attendance($1, 'attended')", [b], "22023");
      await refused(tx, "SELECT app.mark_attendance($1, 'booked')", [b], "22023");
    });
  });
});

describe("rotating QR credential and check-in", () => {
  /** Avoid the last seconds of a 30 s window so a case never straddles a boundary. */
  async function freshWindow() {
    const into = Date.now() % 30_000;
    if (into > 24_000) await sleep(30_000 - into + 200);
  }
  async function tokenAt(org: OrgFixture, member: string, offset: number): Promise<string> {
    const r = await t.admin.query(
      "SELECT app.qr_token_for($1, $2, app.qr_window(clock_timestamp()) + $3) AS t",
      [org.orgId, member, offset],
    );
    return r.rows[0].t;
  }
  const checkIn = (
    claims: Claims,
    member: string | null,
    token: string | null,
    loc = t.fx.A.locations[0],
  ) =>
    asCaller(
      t.api,
      claims,
      async (tx) =>
        (await tx.query("SELECT * FROM app.check_in($1, $2, $3)", [loc, member, token])).rows[0],
    );

  it("a member gets a token; front desk scans it → allowed and recorded with source qr", async () => {
    await freshWindow();
    const m = await newMember(t.fx.A);
    const tok = await asCaller(
      t.api,
      m.claims,
      async (tx) => (await tx.query("SELECT * FROM app.my_qr_token($1)", [m.id])).rows[0],
    );
    expect(tok.token).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[0-9a-f]{32}$/);
    expect(new Date(tok.expires_at).getTime()).toBeGreaterThan(Date.now());
    const r = await checkIn(fd(), null, tok.token);
    expect(r).toMatchObject({ result: "allowed", reason: "active", member_id: m.id });
    const row = await t.admin.query(
      "SELECT source, result, recorded_by FROM app.check_in WHERE id = $1",
      [r.id],
    );
    expect(row.rows[0]).toEqual({
      source: "qr",
      result: "allowed",
      recorded_by: t.fx.A.people.front_desk,
    });
  });

  it("the previous window is still accepted; older (screenshot) and future windows are rejected and recorded", async () => {
    await freshWindow();
    const m = await newMember(t.fx.A);
    expect(await checkIn(fd(), null, await tokenAt(t.fx.A, m.id, -1))).toMatchObject({
      result: "allowed",
    });
    for (const offset of [-2, -40, 1]) {
      const r = await checkIn(fd(), null, await tokenAt(t.fx.A, m.id, offset));
      expect(r, String(offset)).toMatchObject({
        result: "denied",
        reason: "expired_token",
        member_id: m.id,
      });
    }
    const n = await t.admin.query(
      "SELECT result, count(*)::int AS n FROM app.check_in WHERE member_id = $1 GROUP BY result ORDER BY result",
      [m.id],
    );
    expect(n.rows).toEqual([
      { result: "allowed", n: 1 },
      { result: "denied", n: 3 },
    ]);
  });

  it("forged, malformed and other-org tokens are denied as invalid_token and still recorded", async () => {
    await freshWindow();
    const good = await tokenAt(t.fx.A, t.fx.A.members[0], 0);
    const forged = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    const otherMember = good.replace(t.fx.A.members[0], t.fx.A.members[1]);
    const otherOrg = await tokenAt(t.fx.B, t.fx.B.members[0], 0);
    const before = (
      await t.admin.query(
        "SELECT count(*)::int AS n FROM app.check_in WHERE reason = 'invalid_token'",
      )
    ).rows[0].n;
    for (const tok of [forged, otherMember, otherOrg, "hola", "v1.' OR 1=1 --", "x".repeat(500)]) {
      const r = await checkIn(fd(), null, tok);
      expect(r, tok.slice(0, 30)).toMatchObject({
        result: "denied",
        reason: "invalid_token",
        member_id: null,
        full_name: null,
      });
    }
    const after = (
      await t.admin.query(
        "SELECT count(*)::int AS n FROM app.check_in WHERE reason = 'invalid_token'",
      )
    ).rows[0].n;
    expect(after - before).toBe(6);
  });

  it.each([
    ["active", false, "allowed", "active"],
    ["trial", false, "allowed", "trial"],
    ["past_due", false, "allowed", "past_due"],
    ["frozen", false, "denied", "frozen"],
    ["cancelled", false, "denied", "cancelled"],
    ["lead", false, "denied", "lead"],
  ])("front desk check-in by member id: %s → %s", async (status, _d, result, reason) => {
    const m = await newMember(t.fx.A, t.fx.A.locations[0], status);
    expect(await checkIn(fd(), m.id, null)).toMatchObject({
      result,
      reason,
      member_status: status,
    });
  });

  it("past_due is denied only where the owner set deny_past_due, with its own reason", async () => {
    const m = await newMember(t.fx.A, t.fx.A.locations[1], "past_due");
    const owner = t.claims(t.fx.A, "owner");
    await asCaller(t.api, owner, (tx) =>
      tx.query("SELECT app.set_location_policy($1, 6, false, true)", [t.fx.A.locations[1]]),
    );
    expect(await checkIn(owner, m.id, null, t.fx.A.locations[1])).toMatchObject({
      result: "denied",
      reason: "past_due_denied",
    });
    expect(await checkIn(owner, m.id, null, t.fx.A.locations[0])).toMatchObject({
      result: "allowed",
      reason: "past_due",
    });
    await asCaller(t.api, owner, (tx) =>
      tx.query("SELECT app.set_location_policy($1, 6, false, false)", [t.fx.A.locations[1]]),
    );
  });

  it("only front of house at the location checks in; refusals are not recorded", async () => {
    const m = await newMember(t.fx.A);
    const before = (
      await t.admin.query("SELECT count(*)::int AS n FROM app.check_in WHERE member_id = $1", [
        m.id,
      ])
    ).rows[0].n;
    await expect(checkIn(fd(), m.id, null, t.fx.A.locations[1])).rejects.toMatchObject(
      code("42501"),
    );
    for (const role of [
      "trainer",
      "chef",
      "clinician",
      "accountant",
      "member",
      "guardian",
    ] as Role[]) {
      await expect(checkIn(t.claims(t.fx.A, role), m.id, null), role).rejects.toMatchObject(
        code("42501"),
      );
    }
    await expect(
      checkIn(t.claims(t.fx.B, "owner"), m.id, null, t.fx.B.locations[0]),
    ).rejects.toMatchObject(code("42501"));
    await expect(checkIn(fd(), m.id, "v1.x")).rejects.toMatchObject(code("22023"));
    await expect(checkIn(fd(), null, null)).rejects.toMatchObject(code("22023"));
    const after = (
      await t.admin.query("SELECT count(*)::int AS n FROM app.check_in WHERE member_id = $1", [
        m.id,
      ])
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it("only the member or guardian mints a token; staff cannot; the key and signer are unreachable", async () => {
    const m = await newMember(t.fx.A);
    const ward = (
      await t.admin.query("SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1", [
        t.fx.A.people.guardian,
      ])
    ).rows[0].member_id;
    await asCaller(t.api, t.claims(t.fx.A, "guardian"), (tx) =>
      tx.query("SELECT * FROM app.my_qr_token($1)", [ward]),
    );
    for (const claims of [
      t.claims(t.fx.A, "member"),
      t.claims(t.fx.A, "guardian"),
      fd(),
      t.claims(t.fx.A, "owner"),
    ]) {
      await asCaller(t.api, claims, async (tx) => {
        await refused(tx, "SELECT * FROM app.my_qr_token($1)", [m.id], "42501");
      });
    }
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await refused(tx, "SELECT key FROM app_private.qr_key", [], "42501");
      await refused(tx, "SELECT app.qr_token_for($1, $2, 1)", [t.fx.A.orgId, m.id], "42501");
      await refused(tx, "SELECT * FROM app.qr_verify('x')", [], "42501");
      await refused(
        tx,
        "INSERT INTO app.check_in (location_id, member_id, source, result, reason, recorded_by) VALUES ($1, $2, 'front_desk', 'allowed', 'active', $2)",
        [t.fx.A.locations[0], m.id],
        "42501",
      );
    });
  });

  it("check-in history: front desk sees its location, members their own, trainer and chef nothing", async () => {
    await asCaller(t.api, fd(), async (tx) => {
      const r = await tx.query("SELECT DISTINCT location_id FROM app.check_in");
      expect(r.rows.map((x) => x.location_id)).toEqual([t.fx.A.locations[0]]);
    });
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      const r = await tx.query("SELECT DISTINCT member_id FROM app.check_in");
      expect(r.rows.map((x) => x.member_id)).toEqual([t.fx.A.members[0]]);
    });
    for (const role of ["trainer", "chef", "nutritionist"] as Role[]) {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.check_in")).rowCount, role).toBe(0);
      });
    }
  });
});

describe("location policy", () => {
  it("a manager tunes the window but cannot switch deny_past_due; the owner can; changes are audited", async () => {
    const loc = t.fx.A.locations[0];
    await asCaller(t.api, t.claims(t.fx.A, "location_manager"), async (tx) => {
      await tx.query("SELECT app.set_location_policy($1, 24, true, false)", [loc]);
      await refused(tx, "SELECT app.set_location_policy($1, 24, true, true)", [loc], "42501");
      await refused(
        tx,
        "SELECT app.set_location_policy($1, 24, true, false)",
        [t.fx.A.locations[1]],
        "42501",
      );
      await refused(tx, "SELECT app.set_location_policy($1, 99, true, false)", [loc], "23514");
    });
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
      tx.query("SELECT app.set_location_policy($1, 12, false, true)", [loc]),
    );
    const p = await t.admin.query(
      "SELECT cancel_window_hours, deny_past_due FROM app.location_policy WHERE location_id = $1",
      [loc],
    );
    expect(p.rows[0]).toEqual({ cancel_window_hours: 12, deny_past_due: true });
    const a = await t.admin.query(
      "SELECT actor_role, meta->>'deny_past_due' AS d FROM app.audit_log WHERE action = 'location_policy.update' AND entity_id = $1 ORDER BY id",
      [loc],
    );
    expect(a.rows).toEqual([
      { actor_role: "location_manager", d: "false" },
      { actor_role: "owner", d: "true" },
    ]);
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
      tx.query("SELECT app.set_location_policy($1, 12, false, false)", [loc]),
    );
    for (const role of ["front_desk", "trainer", "accountant", "member"] as Role[]) {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        await refused(tx, "SELECT app.set_location_policy($1, 1, false, false)", [loc], "42501");
        await refused(tx, "UPDATE app.location_policy SET deny_past_due = true", [], "42501");
      });
    }
  });
});

describe("appointments", () => {
  const create = (
    claims: Claims,
    kind: string,
    staff: string,
    member: string,
    startsIn: string,
    mins = 60,
  ) =>
    asCaller(t.api, claims, async (tx) => {
      const r = await tx.query(
        "SELECT app.create_appointment($1, $2, $3, $4, now() + $5::interval, now() + $5::interval + make_interval(mins => $6)) AS id",
        [kind, staff, member, t.fx.A.locations[0], startsIn, mins],
      );
      return r.rows[0].id as string;
    });

  it("front desk books personal training; an overlapping slot for the same trainer is refused", async () => {
    const trainer = await staffId(t.fx.A, "trainer");
    const m = await newMember(t.fx.A);
    await create(fd(), "personal_training", trainer, m.id, "30 days");
    await expect(
      create(fd(), "personal_training", trainer, t.fx.A.members[0], "30 days 30 minutes"),
    ).rejects.toMatchObject(code("23505"));
    // Back-to-back is fine.
    await create(t.claims(t.fx.A, "trainer"), "personal_training", trainer, m.id, "30 days 1 hour");
  });

  it("an appointment cannot overlap a class the trainer teaches", async () => {
    const trainer = await staffId(t.fx.A, "trainer");
    await newSession(t.fx.A, { startsIn: "40 days" });
    await expect(
      create(fd(), "personal_training", trainer, t.fx.A.members[0], "40 days 10 minutes"),
    ).rejects.toMatchObject(code("23505"));
  });

  it("CONCURRENCY: two overlapping appointments for one trainer → exactly one is created", async () => {
    const trainer = await staffId(t.fx.A, "trainer");
    const results = await Promise.allSettled([
      create(fd(), "personal_training", trainer, t.fx.A.members[0], "50 days"),
      create(
        t.claims(t.fx.A, "owner"),
        "personal_training",
        trainer,
        t.fx.A.members[1],
        "50 days 15 minutes",
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: code("23505") });
  });

  it("health-related kinds: only the licensed staff member books for themself; front desk never sees them", async () => {
    const nutri = await staffId(t.fx.A, "nutritionist");
    const trainer = await staffId(t.fx.A, "trainer");
    const m = await newMember(t.fx.A);
    await expect(create(fd(), "nutrition", nutri, m.id, "60 days")).rejects.toMatchObject(
      code("42501"),
    );
    await expect(
      create(t.claims(t.fx.A, "trainer"), "nutrition", trainer, m.id, "60 days"),
    ).rejects.toMatchObject(code("22023"));
    const id = await create(t.claims(t.fx.A, "nutritionist"), "nutrition", nutri, m.id, "60 days");
    for (const role of [
      "front_desk",
      "chef",
      "accountant",
      "owner",
      "location_manager",
      "trainer",
    ] as Role[]) {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        expect(
          (await tx.query("SELECT 1 FROM app.appointment WHERE id = $1", [id])).rowCount,
          role,
        ).toBe(0);
      });
    }
    for (const claims of [
      m.claims,
      t.claims(t.fx.A, "nutritionist"),
      t.claims(t.fx.A, "clinician"),
    ]) {
      await asCaller(t.api, claims, async (tx) => {
        expect(
          (await tx.query("SELECT kind FROM app.appointment WHERE id = $1", [id])).rows,
        ).toEqual([{ kind: "nutrition" }]);
      });
    }
    const a = await t.admin.query(
      "SELECT meta FROM app.audit_log WHERE action = 'appointment.create' AND entity_id = $1",
      [id],
    );
    expect(a.rows[0].meta).toEqual({ status: "scheduled", kind: "restricted" });
  });

  it("cancel: the member or the assigned staff; not another member or the chef; never twice", async () => {
    const trainer = await staffId(t.fx.A, "trainer");
    const m = await newMember(t.fx.A);
    const id = await create(fd(), "personal_training", trainer, m.id, "70 days");
    for (const claims of [
      t.claims(t.fx.A, "member"),
      t.claims(t.fx.A, "chef"),
      t.claims(t.fx.B, "owner"),
    ]) {
      await expect(
        asCaller(t.api, claims, (tx) => tx.query("SELECT app.cancel_appointment($1)", [id])),
      ).rejects.toMatchObject(code("42501"));
    }
    await asCaller(t.api, m.claims, (tx) => tx.query("SELECT app.cancel_appointment($1)", [id]));
    await expect(
      asCaller(t.api, m.claims, (tx) => tx.query("SELECT app.cancel_appointment($1)", [id])),
    ).rejects.toMatchObject(code("22023"));
    // The freed slot can be booked again.
    await create(fd(), "personal_training", trainer, m.id, "70 days");
  });

  it("appointments are not writable directly and another org's staff cannot be used", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await refused(tx, "UPDATE app.appointment SET status = 'cancelled'", [], "42501");
      await refused(
        tx,
        "SELECT app.create_appointment('personal_training', $1, $2, $3, now() + interval '80 days', now() + interval '80 days 1 hour')",
        [await staffId(t.fx.B, "trainer"), t.fx.A.members[0], t.fx.A.locations[0]],
        "22023",
      );
      await refused(
        tx,
        "SELECT app.create_appointment('personal_training', $1, $2, $3, now() + interval '80 days', now() + interval '80 days 1 hour')",
        [await staffId(t.fx.A, "trainer"), t.fx.B.members[0], t.fx.A.locations[0]],
        "42501",
      );
    });
  });
});
