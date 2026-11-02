import { randomUUID } from "node:crypto";
import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

interface NewMember {
  memberId: string;
  personId: string;
}

/** A member of its own for each case (admin path), optionally a minor (guardian link to the fixture guardian). */
async function newMember(
  org: OrgFixture,
  opts: { loc?: 0 | 1; minor?: boolean; name?: string; email?: string; status?: string } = {},
): Promise<NewMember> {
  const email = opts.email ?? `eng-${randomUUID().slice(0, 8)}@demo.invalid`;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [email],
  );
  const personId = p.rows[0]?.id as string;
  const m = await t.admin.query<{ id: string }>(
    `INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      org.orgId,
      personId,
      org.locations[opts.loc ?? 0],
      opts.name ?? "Demo Prueba Socio",
      opts.status ?? "active",
    ],
  );
  const memberId = m.rows[0]?.id as string;
  if (opts.minor)
    await t.admin.query(
      "INSERT INTO app.guardian_link (org_id, guardian_person_id, member_id) VALUES ($1,$2,$3)",
      [org.orgId, org.people.guardian, memberId],
    );
  return { memberId, personId };
}

/** Seed points or visits directly (admin path), optionally in the past. */
async function ledger(
  org: OrgFixture,
  memberId: string,
  delta: number,
  reason = "manual",
  ago = "0 days",
) {
  await t.admin.query(
    `INSERT INTO app.points_ledger (org_id, member_id, delta, reason, note, created_by, at)
     VALUES ($1,$2,$3,$4,$5,$6, now() - $7::interval)`,
    [
      org.orgId,
      memberId,
      delta,
      reason,
      reason === "manual" ? "Demo prueba" : null,
      org.people.owner,
      ago,
    ],
  );
}
async function balance(memberId: string): Promise<number> {
  const r = await t.admin.query(
    "SELECT coalesce(sum(delta),0)::int AS b FROM app.points_ledger WHERE member_id = $1",
    [memberId],
  );
  return r.rows[0].b;
}
const self = (org: OrgFixture, m: NewMember) => t.claims(org, "member", m.personId);
const as = (org: OrgFixture, role: Role) => t.claims(org, role);

/** Expect the last statement to fail with this SQLSTATE (and optional message); the transaction is rolled back. */
async function denied(
  claims: ReturnType<typeof as>,
  sql: string,
  params: unknown[],
  code: string,
  msg?: RegExp,
) {
  await expect(asCaller(t.api, claims, (tx) => tx.query(sql, params))).rejects.toMatchObject({
    code,
    ...(msg ? { message: expect.stringMatching(msg) } : {}),
  });
}
/** Run as a caller and roll back at the end (configuration changes that must not leak into other cases). */
async function rolledBack<T>(
  claims: ReturnType<typeof as>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const c = await t.api.pool.connect();
  try {
    await c.query("BEGIN");
    await bindClaims(c, t.api, claims);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
async function newChallenge(
  org: OrgFixture,
  over: Partial<{
    kind: string;
    metric: string;
    goal: number;
    location: string | null;
    optIn: boolean;
  }> = {},
): Promise<string> {
  const r = await t.admin.query<{ id: string }>(
    `INSERT INTO app.challenge (org_id, name, kind, metric, location_id, starts_on, ends_on, goal, leaderboard_opt_in_default, created_by)
     VALUES ($1, 'Reto Demo Prueba', $2, $3, $4, current_date - 1, current_date + 14, $5, $6, $7) RETURNING id`,
    [
      org.orgId,
      over.kind ?? "individual",
      over.metric ?? "visits",
      over.location ?? null,
      over.goal ?? 5,
      over.optIn ?? false,
      org.people.owner,
    ],
  );
  return r.rows[0]?.id as string;
}
async function newTeam(org: OrgFixture, challengeId: string, name: string): Promise<string> {
  const r = await t.admin.query<{ id: string }>(
    "INSERT INTO app.challenge_team (org_id, challenge_id, name) VALUES ($1,$2,$3) RETURNING id",
    [org.orgId, challengeId, name],
  );
  return r.rows[0]?.id as string;
}

const AWARD = "SELECT app.award_points($1, $2::app.eng_event, $3) AS pts";
const JOIN = "SELECT app.join_challenge($1, $2, $3, $4) AS id";
const REDEEM = "SELECT app.redeem_reward($1, $2) AS id";
const BOARD = "SELECT division, rank, label, progress, is_me FROM app.leaderboard($1)";

async function rewardId(org: OrgFixture, restricted: boolean): Promise<string> {
  const r = await t.admin.query(
    "SELECT id FROM app.reward WHERE org_id = $1 AND restricted_for_minors = $2 AND active ORDER BY points_cost LIMIT 1",
    [org.orgId, restricted],
  );
  return r.rows[0].id;
}

describe("rules and rewards configuration", () => {
  it("only the owner changes org-wide rules and rewards (security review H1); the change is audited", async () => {
    await rolledBack(as(t.fx.A, "location_manager"), async (tx) => {
      const r = await tx.query("UPDATE app.points_rule SET points = 10000");
      expect(r.rowCount).toBe(0);
      const w = await tx.query("UPDATE app.reward SET points_cost = 1");
      expect(w.rowCount).toBe(0);
    });
    for (const role of ["owner"] as const) {
      await rolledBack(as(t.fx.A, role), async (tx) => {
        const u = await tx.query("UPDATE app.points_rule SET points = 12 WHERE event = 'visit'");
        expect(u.rowCount, role).toBe(1);
        const a = await tx.query(
          "SELECT actor_person_id, actor_role FROM app.audit_log WHERE action = 'points_rule.update' ORDER BY id DESC LIMIT 1",
        );
        // location managers read the audit of their locations only; the owner reads it all.
        if (role === "owner")
          expect(a.rows[0]).toEqual({ actor_person_id: t.fx.A.people.owner, actor_role: "owner" });
      });
    }
    const audit = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'points_rule.update' AND org_id = $1",
      [t.fx.A.orgId],
    );
    expect(audit.rows[0].n).toBe(0); // rolled back with the change
  });

  it.each(["front_desk", "trainer", "accountant", "member", "guardian", "chef"] as Role[])(
    "%s cannot create or change rules and rewards",
    async (role) => {
      await denied(
        as(t.fx.A, role),
        "INSERT INTO app.reward (name, points_cost) VALUES ('Toalla Demo', 50)",
        [],
        "42501",
      );
      const u = await asCaller(t.api, as(t.fx.A, role), (tx) =>
        tx.query("UPDATE app.points_rule SET points = 9999"),
      );
      expect(u.rowCount).toBe(0);
    },
  );

  it("members see only active rules and rewards; trainer, accountant and chef see none", async () => {
    const off = await t.admin.query<{ id: string }>(
      "INSERT INTO app.reward (org_id, name, points_cost, active) VALUES ($1, 'Inactiva Demo', 10, false) RETURNING id",
      [t.fx.A.orgId],
    );
    await asCaller(t.api, as(t.fx.A, "member"), async (tx) => {
      const r = await tx.query("SELECT id, active FROM app.reward");
      expect(r.rowCount).toBeGreaterThan(0);
      expect(r.rows.every((x) => x.active)).toBe(true);
      expect(r.rows.map((x) => x.id)).not.toContain(off.rows[0]?.id);
    });
    for (const role of ["trainer", "accountant", "chef"] as Role[]) {
      await asCaller(t.api, as(t.fx.A, role), async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.points_rule")).rowCount, role).toBe(0);
        expect((await tx.query("SELECT 1 FROM app.reward")).rowCount, role).toBe(0);
        expect((await tx.query("SELECT 1 FROM app.points_ledger")).rowCount, role).toBe(0);
      });
    }
  });

  it("cash prizes, raffles and sweepstakes cannot be configured as rewards [VERIFICAR · legal PR]", async () => {
    for (const name of [
      "Premio en efectivo",
      "Sorteo iPhone",
      "Rifa mensual",
      "Cash 50",
      "Sweepstakes Demo",
    ]) {
      await denied(
        as(t.fx.A, "owner"),
        "INSERT INTO app.reward (name, points_cost) VALUES ($1, 50)",
        [name],
        "23514",
      );
    }
    await denied(
      as(t.fx.A, "owner"),
      "INSERT INTO app.reward (name, points_cost) VALUES ('<script>x', 50)",
      [],
      "23514",
    );
  });

  it("identity and money columns are not writable by request traffic", async () => {
    const o = as(t.fx.A, "owner");
    await denied(o, "UPDATE app.reward SET org_id = $1", [t.fx.B.orgId], "42501");
    await denied(o, "UPDATE app.points_rule SET event = 'referral'", [], "42501");
    await denied(
      o,
      "INSERT INTO app.points_ledger (member_id, delta, reason, created_by) VALUES ($1, 999, 'visit', $2)",
      [t.fx.A.members[0], t.fx.A.people.owner],
      "42501",
    );
    await denied(o, "UPDATE app.points_ledger SET delta = 999999", [], "42501");
    await denied(o, "DELETE FROM app.points_ledger", [], "42501");
    await denied(o, "UPDATE app.redemption SET status = 'fulfilled'", [], "42501");
    await denied(
      o,
      "UPDATE app.challenge_participant SET show_on_leaderboard = true, progress = 999",
      [],
      "42501",
    );
    await denied(o, "UPDATE app.challenge SET created_by = $1", [t.fx.A.people.member], "42501");
    await denied(o, "UPDATE app.community_post SET status = 'approved'", [], "42501");
    await denied(
      o,
      "UPDATE app.referral SET status = 'credited', credit_points = 1000",
      [],
      "42501",
    );
    await denied(
      o,
      "INSERT INTO app.achievement (member_id, code) VALUES ($1, 'streak_12')",
      [t.fx.A.members[0]],
      "42501",
    );
  });

  it("the ledger is append-only even for the database owner path", async () => {
    await expect(t.admin.query("UPDATE app.points_ledger SET delta = 1")).rejects.toThrow(
      /append_only/,
    );
    await expect(t.admin.query("DELETE FROM app.points_ledger")).rejects.toThrow(/append_only/);
  });

  it("internal helpers are not callable by request traffic", async () => {
    const o = as(t.fx.A, "owner");
    await denied(o, "SELECT app.eng_credit($1, 'visit', NULL, NULL)", [t.fx.A.members[0]], "42501");
    await denied(o, "SELECT app.eng_refresh_progress($1)", [t.fx.A.members[0]], "42501");
    await denied(o, "SELECT app.eng_lock_member($1)", [t.fx.A.members[0]], "42501");
  });
});

describe("award_points", () => {
  it("front desk awards a visit at its location: ledger row, first_visit badge and audit with the real actor", async () => {
    const m = await newMember(t.fx.A);
    const r = await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) =>
      tx.query(AWARD, [m.memberId, "visit", null]),
    );
    expect(r.rows[0].pts).toBe(10);
    expect(await balance(m.memberId)).toBe(10);
    const badge = await t.admin.query("SELECT code FROM app.achievement WHERE member_id = $1", [
      m.memberId,
    ]);
    expect(badge.rows.map((x) => x.code)).toEqual(["first_visit"]);
    const audit = await t.admin.query(
      "SELECT actor_person_id, actor_role, location_id FROM app.audit_log WHERE action = 'points.award' AND entity_id = $1",
      [m.memberId],
    );
    expect(audit.rows).toEqual([
      {
        actor_person_id: t.fx.A.people.front_desk,
        actor_role: "front_desk",
        location_id: t.fx.A.locations[0],
      },
    ]);
  });

  it("one visit per day, one credit per reference (idempotent)", async () => {
    const m = await newMember(t.fx.A);
    const fd = as(t.fx.A, "front_desk");
    await asCaller(t.api, fd, (tx) => tx.query(AWARD, [m.memberId, "visit", null]));
    await denied(fd, AWARD, [m.memberId, "visit", null], "23505", /already_awarded/);
    await asCaller(t.api, fd, (tx) => tx.query(AWARD, [m.memberId, "class", "booking-123"]));
    await denied(fd, AWARD, [m.memberId, "class", "booking-123"], "23505", /already_awarded/);
    expect(await balance(m.memberId)).toBe(25);
  });

  it("a visit after ≥ 14 days away earns the comeback bonus; after 10 days it does not", async () => {
    const back = await newMember(t.fx.A);
    await ledger(t.fx.A, back.memberId, 10, "visit", "20 days");
    const r = await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) =>
      tx.query(AWARD, [back.memberId, "visit", null]),
    );
    expect(r.rows[0].pts).toBe(60);
    const badge = await t.admin.query("SELECT code FROM app.achievement WHERE member_id = $1", [
      back.memberId,
    ]);
    expect(badge.rows.map((x) => x.code)).toContain("comeback");

    const recent = await newMember(t.fx.A);
    await ledger(t.fx.A, recent.memberId, 10, "visit", "10 days");
    const r2 = await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) =>
      tx.query(AWARD, [recent.memberId, "visit", null]),
    );
    expect(r2.rows[0].pts).toBe(10);
  });

  it("other location, other org and non-front-of-house roles are refused", async () => {
    const atLoc1 = await newMember(t.fx.A, { loc: 1 });
    await denied(as(t.fx.A, "front_desk"), AWARD, [atLoc1.memberId, "visit", null], "42501");
    await denied(as(t.fx.A, "location_manager"), AWARD, [atLoc1.memberId, "visit", null], "42501");
    await denied(as(t.fx.B, "owner"), AWARD, [t.fx.A.members[0], "visit", null], "42501");
    for (const role of [
      "trainer",
      "accountant",
      "chef",
      "nutritionist",
      "clinician",
      "member",
      "guardian",
    ] as Role[])
      await denied(as(t.fx.A, role), AWARD, [t.fx.A.members[0], "class", `x-${role}`], "42501");
    expect(await balance(atLoc1.memberId)).toBe(0);
  });

  it("system-only events and hostile references are refused", async () => {
    const m = await newMember(t.fx.A);
    const fd = as(t.fx.A, "front_desk");
    for (const ev of ["challenge_goal", "referral", "comeback_bonus"])
      await denied(fd, AWARD, [m.memberId, ev, null], "22023", /event_not_awardable/);
    for (const ref of ["x' OR 1=1 --", "a b", "{{brand}}", "x".repeat(81)])
      await denied(fd, AWARD, [m.memberId, "class", ref], "22023", /invalid_ref/);
    expect(await balance(m.memberId)).toBe(0);
  });

  it("an inactive rule awards nothing", async () => {
    const m = await newMember(t.fx.A);
    await t.admin.query(
      "UPDATE app.points_rule SET active = false WHERE org_id = $1 AND event = 'purchase'",
      [t.fx.A.orgId],
    );
    try {
      await denied(
        as(t.fx.A, "front_desk"),
        AWARD,
        [m.memberId, "purchase", "sale-1"],
        "22023",
        /no_active_rule/,
      );
    } finally {
      await t.admin.query(
        "UPDATE app.points_rule SET active = true WHERE org_id = $1 AND event = 'purchase'",
        [t.fx.A.orgId],
      );
    }
  });
});

describe("manual points", () => {
  const MANUAL = "SELECT app.award_manual_points($1, $2, $3) AS id";
  it("front desk awards with a reason; a correction cannot overdraw; reasons are mandatory and sanitised", async () => {
    const m = await newMember(t.fx.A);
    const fd = as(t.fx.A, "front_desk");
    await asCaller(t.api, fd, (tx) => tx.query(MANUAL, [m.memberId, 40, "Demo: ayuda en evento"]));
    expect(await balance(m.memberId)).toBe(40);
    await denied(fd, MANUAL, [m.memberId, -41, "Demo corrección"], "22023", /insufficient_points/);
    await asCaller(t.api, fd, (tx) => tx.query(MANUAL, [m.memberId, -40, "Demo corrección"]));
    expect(await balance(m.memberId)).toBe(0);
    for (const note of ["", "  ", "<b>x</b>", "hola\nmundo", "{{name}}"])
      await denied(fd, MANUAL, [m.memberId, 5, note], "22023", /reason_required/);
    for (const delta of [0, 10001, -10001])
      await denied(fd, MANUAL, [m.memberId, delta, "Demo"], "22023", /invalid_delta/);
    await denied(as(t.fx.A, "trainer"), MANUAL, [m.memberId, 5, "Demo"], "42501");
    await denied(self(t.fx.A, m), MANUAL, [m.memberId, 5, "Demo regalo"], "42501");
  });
});

describe("rewards and redemptions", () => {
  it("a member redeems for themself: balance drops, redemption requested, audited", async () => {
    const m = await newMember(t.fx.A);
    await ledger(t.fx.A, m.memberId, 150);
    const reward = await rewardId(t.fx.A, false);
    const r = await asCaller(t.api, self(t.fx.A, m), async (tx) => {
      const { rows } = await tx.query(REDEEM, [m.memberId, reward]);
      return tx.query("SELECT status, points FROM app.redemption WHERE id = $1", [rows[0].id]);
    });
    expect(r.rows[0]).toEqual({ status: "requested", points: 100 });
    expect(await balance(m.memberId)).toBe(50);
    await denied(self(t.fx.A, m), REDEEM, [m.memberId, reward], "22023", /insufficient_points/);
    const audit = await t.admin.query(
      "SELECT actor_person_id FROM app.audit_log WHERE action = 'reward.redeem' AND meta->>'member_id' = $1",
      [m.memberId],
    );
    expect(audit.rows).toEqual([{ actor_person_id: m.personId }]);
  });

  it("CONCURRENCY: two simultaneous redemptions cannot overdraw the balance", async () => {
    const m = await newMember(t.fx.A);
    await ledger(t.fx.A, m.memberId, 150); // enough for ONE 100-point reward
    const reward = await rewardId(t.fx.A, false);
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    let second: unknown = null;
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, self(t.fx.A, m));
      await c1.query(REDEEM, [m.memberId, reward]); // holds the member lock
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, as(t.fx.A, "front_desk"));
      const racing = c2.query(REDEEM, [m.memberId, reward]).catch((e: unknown) => {
        second = e;
      });
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("COMMIT");
      await racing;
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    expect(second).toMatchObject({ message: "insufficient_points" });
    expect(await balance(m.memberId)).toBe(50);
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.redemption WHERE member_id = $1",
      [m.memberId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("minors (guardian link) are refused restricted rewards but may redeem unrestricted ones", async () => {
    const kid = await newMember(t.fx.A, { minor: true });
    await ledger(t.fx.A, kid.memberId, 1000);
    await denied(
      self(t.fx.A, kid),
      REDEEM,
      [kid.memberId, await rewardId(t.fx.A, true)],
      "42501",
      /restricted_for_minors/,
    );
    await denied(
      as(t.fx.A, "front_desk"),
      REDEEM,
      [kid.memberId, await rewardId(t.fx.A, true)],
      "42501",
      /restricted_for_minors/,
    );
    expect(await balance(kid.memberId)).toBe(1000);
    await asCaller(t.api, self(t.fx.A, kid), async (tx) =>
      tx.query(REDEEM, [kid.memberId, await rewardId(t.fx.A, false)]),
    );
    expect(await balance(kid.memberId)).toBe(900);
  });

  it("guardians, other members, other locations and other orgs cannot redeem for a member", async () => {
    const kid = await newMember(t.fx.A, { minor: true });
    const other = await newMember(t.fx.A);
    const atLoc1 = await newMember(t.fx.A, { loc: 1 });
    await ledger(t.fx.A, kid.memberId, 1000);
    await ledger(t.fx.A, atLoc1.memberId, 1000);
    const reward = await rewardId(t.fx.A, false);
    await denied(as(t.fx.A, "guardian"), REDEEM, [kid.memberId, reward], "42501");
    await denied(self(t.fx.A, other), REDEEM, [kid.memberId, reward], "42501");
    await denied(as(t.fx.A, "front_desk"), REDEEM, [atLoc1.memberId, reward], "42501");
    await denied(as(t.fx.B, "owner"), REDEEM, [kid.memberId, reward], "42501");
    await denied(as(t.fx.A, "trainer"), REDEEM, [kid.memberId, reward], "42501");
    // A reward of org B is not redeemable in org A.
    await denied(
      self(t.fx.A, kid),
      REDEEM,
      [kid.memberId, await rewardId(t.fx.B, false)],
      "22023",
      /reward_unavailable/,
    );
    expect(await balance(kid.memberId)).toBe(1000);
  });

  it("front desk fulfils; the member can cancel their own request (refunded) but never fulfil it", async () => {
    const m = await newMember(t.fx.A);
    await ledger(t.fx.A, m.memberId, 300);
    const reward = await rewardId(t.fx.A, false);
    const ids = await asCaller(t.api, self(t.fx.A, m), async (tx) => [
      (await tx.query(REDEEM, [m.memberId, reward])).rows[0].id,
      (await tx.query(REDEEM, [m.memberId, reward])).rows[0].id,
    ]);
    const SET = "SELECT app.set_redemption_status($1, $2)";
    await denied(self(t.fx.A, m), SET, [ids[0], "fulfilled"], "42501");
    await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) => tx.query(SET, [ids[0], "fulfilled"]));
    await denied(
      as(t.fx.A, "front_desk"),
      SET,
      [ids[0], "cancelled"],
      "22023",
      /invalid_transition/,
    );
    await asCaller(t.api, self(t.fx.A, m), (tx) => tx.query(SET, [ids[1], "cancelled"]));
    expect(await balance(m.memberId)).toBe(200);
    await denied(as(t.fx.B, "owner"), SET, [ids[0], "cancelled"], "42501");
    const audit = await t.admin.query(
      "SELECT action FROM app.audit_log WHERE entity = 'redemption' AND entity_id = ANY($1) ORDER BY id",
      [ids],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "reward.redeem",
      "reward.redeem",
      "redemption.fulfilled",
      "redemption.cancelled",
    ]);
  });
});

describe("challenges", () => {
  it("owner creates any challenge; a location manager only for own location; front desk none", async () => {
    const insert = `INSERT INTO app.challenge (name, kind, metric, location_id, starts_on, ends_on, goal)
                    VALUES ('Reto Demo', 'individual', 'visits', $1, current_date, current_date + 7, 4)`;
    await rolledBack(as(t.fx.A, "owner"), async (tx) => {
      await tx.query(insert, [null]);
      const r = await tx.query("SELECT created_by FROM app.challenge WHERE name = 'Reto Demo'");
      expect(r.rows[0].created_by).toBe(t.fx.A.people.owner);
    });
    await rolledBack(as(t.fx.A, "location_manager"), (tx) =>
      tx.query(insert, [t.fx.A.locations[0]]),
    );
    await denied(as(t.fx.A, "location_manager"), insert, [t.fx.A.locations[1]], "42501");
    await denied(as(t.fx.A, "location_manager"), insert, [null], "42501");
    await denied(as(t.fx.A, "front_desk"), insert, [t.fx.A.locations[0]], "42501");
    await denied(as(t.fx.A, "trainer"), insert, [t.fx.A.locations[0]], "42501");
    await denied(as(t.fx.A, "owner"), insert, [t.fx.B.locations[0]], "23503");
  });

  it("trainer views challenges; accountant, chef and clinician do not; teams only on team challenges", async () => {
    await asCaller(t.api, as(t.fx.A, "trainer"), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.challenge")).rowCount).toBeGreaterThan(0);
      expect((await tx.query("SELECT 1 FROM app.challenge_participant")).rowCount).toBe(0);
    });
    for (const role of ["accountant", "chef", "clinician"] as Role[])
      await asCaller(t.api, as(t.fx.A, role), async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.challenge")).rowCount, role).toBe(0);
      });
    const indiv = await newChallenge(t.fx.A);
    const team = await newChallenge(t.fx.A, { kind: "team" });
    await denied(
      as(t.fx.A, "owner"),
      "INSERT INTO app.challenge_team (challenge_id, name) VALUES ($1, 'Azul')",
      [indiv],
      "42501",
    );
    await rolledBack(as(t.fx.A, "owner"), (tx) =>
      tx.query("INSERT INTO app.challenge_team (challenge_id, name) VALUES ($1, 'Azul')", [team]),
    );
  });

  it("a member joins for themself: not listed by default, beginners compare with themselves", async () => {
    const m = await newMember(t.fx.A);
    const c = await newChallenge(t.fx.A);
    const r = await asCaller(t.api, self(t.fx.A, m), async (tx) => {
      const { rows } = await tx.query(JOIN, [c, m.memberId, null, null]);
      return tx.query(
        "SELECT show_on_leaderboard, compare_mode FROM app.challenge_participant WHERE id = $1",
        [rows[0].id],
      );
    });
    expect(r.rows[0]).toEqual({ show_on_leaderboard: false, compare_mode: "self" });
    await denied(self(t.fx.A, m), JOIN, [c, m.memberId, null, null], "23505");
  });

  it("nobody joins for someone else except front of house; minors are never listed", async () => {
    const m = await newMember(t.fx.A);
    const other = await newMember(t.fx.A);
    const kid = await newMember(t.fx.A, { minor: true });
    const c = await newChallenge(t.fx.A, { optIn: true });
    await denied(self(t.fx.A, other), JOIN, [c, m.memberId, null, true], "42501");
    await denied(as(t.fx.A, "guardian"), JOIN, [c, kid.memberId, null, null], "42501");
    await denied(as(t.fx.A, "trainer"), JOIN, [c, m.memberId, null, null], "42501");
    await denied(as(t.fx.B, "owner"), JOIN, [c, m.memberId, null, null], "42501");
    await denied(
      self(t.fx.A, kid),
      JOIN,
      [c, kid.memberId, null, true],
      "42501",
      /minor_not_listed/,
    );
    await asCaller(t.api, self(t.fx.A, kid), (tx) => tx.query(JOIN, [c, kid.memberId, null, null]));
    const r = await t.admin.query(
      "SELECT show_on_leaderboard FROM app.challenge_participant WHERE member_id = $1",
      [kid.memberId],
    );
    expect(r.rows[0].show_on_leaderboard).toBe(false); // the challenge default (true) does not apply to minors
    await denied(
      self(t.fx.A, kid),
      "SELECT app.set_challenge_preferences($1,$2,true,'ranked')",
      [c, kid.memberId],
      "42501",
    );
  });

  it("team and location rules are enforced at join", async () => {
    const m = await newMember(t.fx.A);
    const team = await newChallenge(t.fx.A, { kind: "team" });
    const otherTeamChallenge = await newChallenge(t.fx.A, { kind: "team" });
    const foreignTeam = await newTeam(t.fx.A, otherTeamChallenge, "Ajeno");
    await denied(self(t.fx.A, m), JOIN, [team, m.memberId, null, null], "22023", /invalid_team/);
    await denied(
      self(t.fx.A, m),
      JOIN,
      [team, m.memberId, foreignTeam, null],
      "22023",
      /invalid_team/,
    );
    const atLoc1Only = await newChallenge(t.fx.A, { location: t.fx.A.locations[1] });
    await denied(
      self(t.fx.A, m),
      JOIN,
      [atLoc1Only, m.memberId, null, null],
      "42501",
      /forbidden_location/,
    );
  });

  it("awards update progress; reaching the goal credits challenge_goal once", async () => {
    const m = await newMember(t.fx.A);
    const c = await newChallenge(t.fx.A, { metric: "classes", goal: 2 });
    await asCaller(t.api, self(t.fx.A, m), (tx) => tx.query(JOIN, [c, m.memberId, null, null]));
    const fd = as(t.fx.A, "front_desk");
    await asCaller(t.api, fd, (tx) => tx.query(AWARD, [m.memberId, "class", "k1"]));
    const r = await asCaller(t.api, fd, (tx) => tx.query(AWARD, [m.memberId, "class", "k2"]));
    expect(r.rows[0].pts).toBe(15 + 100);
    await asCaller(t.api, fd, (tx) => tx.query(AWARD, [m.memberId, "class", "k3"]));
    const p = await t.admin.query(
      "SELECT progress, goal_reached_at IS NOT NULL AS done FROM app.challenge_participant WHERE member_id = $1",
      [m.memberId],
    );
    expect(p.rows[0]).toEqual({ progress: 3, done: true });
    expect(await balance(m.memberId)).toBe(45 + 100);
  });
});

describe("leaderboard", () => {
  it("lists only opted-in participants; members in ranked mode also get their own row; others stay hidden", async () => {
    const c = await newChallenge(t.fx.A);
    const listed = await newMember(t.fx.A, { name: "Demo Listado Uno" });
    const hidden = await newMember(t.fx.A, { name: "Demo Oculto Dos" });
    const kid = await newMember(t.fx.A, { minor: true, name: "Demo Menor Tres" });
    await asCaller(t.api, self(t.fx.A, listed), (tx) =>
      tx.query(JOIN, [c, listed.memberId, null, true]),
    );
    await asCaller(t.api, self(t.fx.A, hidden), async (tx) => {
      await tx.query(JOIN, [c, hidden.memberId, null, false]);
      await tx.query("SELECT app.set_challenge_preferences($1,$2,false,'ranked')", [
        c,
        hidden.memberId,
      ]);
    });
    await asCaller(t.api, self(t.fx.A, kid), (tx) => tx.query(JOIN, [c, kid.memberId, null, null]));

    for (const role of ["owner", "location_manager", "front_desk", "trainer"] as Role[]) {
      const b = await asCaller(t.api, as(t.fx.A, role), (tx) => tx.query(BOARD, [c]));
      expect(
        b.rows.map((r) => r.label),
        role,
      ).toEqual(["Demo L."]);
    }
    const mine = await asCaller(t.api, self(t.fx.A, hidden), (tx) => tx.query(BOARD, [c]));
    expect(mine.rows).toEqual([
      { division: "self", rank: null, label: "Demo O.", progress: 0, is_me: true },
      { division: "individual", rank: 1, label: "Demo L.", progress: 0, is_me: false },
    ]);
    const g = await asCaller(t.api, as(t.fx.A, "guardian"), (tx) => tx.query(BOARD, [c]));
    expect(g.rows.map((r) => r.label)).toEqual(["Demo M."]);
    const beginner = await asCaller(t.api, self(t.fx.A, listed), (tx) => tx.query(BOARD, [c]));
    expect(beginner.rows.map((r) => r.division)).toEqual(["self"]);
  });

  it("accountant, chef and the other organisation are refused", async () => {
    const c = await newChallenge(t.fx.A);
    for (const role of ["accountant", "chef", "clinician", "nutritionist"] as Role[])
      await denied(as(t.fx.A, role), BOARD, [c], "42501");
    await denied(as(t.fx.B, "owner"), BOARD, [c], "42501");
    await denied(as(t.fx.B, "member"), BOARD, [c], "42501");
    const atLoc1 = await newChallenge(t.fx.A, { location: t.fx.A.locations[1] });
    await denied(as(t.fx.A, "front_desk"), BOARD, [atLoc1], "42501");
  });

  it("divisions follow the kind: teams and locations aggregate opted-in progress", async () => {
    const tc = await newChallenge(t.fx.A, { kind: "team", metric: "classes" });
    const red = await newTeam(t.fx.A, tc, "Rojo");
    const blue = await newTeam(t.fx.A, tc, "Azul");
    const a = await newMember(t.fx.A);
    const b = await newMember(t.fx.A);
    await asCaller(t.api, self(t.fx.A, a), (tx) => tx.query(JOIN, [tc, a.memberId, red, true]));
    await asCaller(t.api, self(t.fx.A, b), (tx) => tx.query(JOIN, [tc, b.memberId, blue, true]));
    await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) =>
      tx.query(AWARD, [b.memberId, "class", "t1"]),
    );
    const board = await asCaller(t.api, as(t.fx.A, "owner"), (tx) => tx.query(BOARD, [tc]));
    expect(board.rows).toEqual([
      { division: "team", rank: 1, label: "Azul", progress: 1, is_me: false },
      { division: "team", rank: 2, label: "Rojo", progress: 0, is_me: false },
    ]);

    const lc = await newChallenge(t.fx.A, { kind: "location" });
    const l1 = await newMember(t.fx.A, { loc: 1 });
    await asCaller(t.api, as(t.fx.A, "owner"), async (tx) => {
      await tx.query(JOIN, [lc, a.memberId, null, true]);
      await tx.query(JOIN, [lc, l1.memberId, null, true]);
    });
    const loc = await asCaller(t.api, as(t.fx.A, "owner"), (tx) => tx.query(BOARD, [lc]));
    expect(loc.rows.map((r) => r.division)).toEqual(["location", "location"]);
  });
});

describe("weekly streak", () => {
  it("counts consecutive ISO weeks with ≥ 1 visit (weekly, not daily)", async () => {
    const m = await newMember(t.fx.A);
    for (const ago of ["0 days", "1 hour", "7 days", "14 days", "28 days"])
      await ledger(t.fx.A, m.memberId, 10, "visit", ago);
    const r = await asCaller(t.api, self(t.fx.A, m), (tx) =>
      tx.query("SELECT app.weekly_streak($1) AS s", [m.memberId]),
    );
    expect(r.rows[0].s).toBe(3);
    const lastWeekOnly = await newMember(t.fx.A);
    await ledger(t.fx.A, lastWeekOnly.memberId, 10, "visit", "7 days");
    const r2 = await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) =>
      tx.query("SELECT app.weekly_streak($1) AS s", [lastWeekOnly.memberId]),
    );
    expect(r2.rows[0].s).toBe(1); // still alive until this week ends
  });

  it("only the member, their guardian and front-of-house staff can read it", async () => {
    const m = await newMember(t.fx.A);
    const kid = await newMember(t.fx.A, { minor: true });
    const other = await newMember(t.fx.A);
    const Q = "SELECT app.weekly_streak($1) AS s";
    await asCaller(t.api, as(t.fx.A, "guardian"), (tx) => tx.query(Q, [kid.memberId]));
    await denied(self(t.fx.A, other), Q, [m.memberId], "42501");
    await denied(as(t.fx.A, "guardian"), Q, [m.memberId], "42501");
    await denied(as(t.fx.A, "trainer"), Q, [m.memberId], "42501");
    await denied(as(t.fx.B, "owner"), Q, [m.memberId], "42501");
  });
});

describe("referrals", () => {
  const CREATE = "SELECT app.create_referral($1, $2) AS id";
  const CREDIT = "SELECT app.credit_referral($1) AS s";
  it("member invites by email (pending, nothing sent); front desk credits once the invitee is an active member", async () => {
    const m = await newMember(t.fx.A);
    const email = `invitado-${randomUUID().slice(0, 6)}@demo.invalid`;
    const id = (
      await asCaller(t.api, self(t.fx.A, m), (tx) => tx.query(CREATE, [m.memberId, email]))
    ).rows[0].id;
    const other = await newMember(t.fx.A);
    expect(
      (
        await asCaller(t.api, self(t.fx.A, other), (tx) =>
          tx.query("SELECT 1 FROM app.referral WHERE id = $1", [id]),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await asCaller(t.api, as(t.fx.A, "trainer"), (tx) => tx.query("SELECT 1 FROM app.referral")))
        .rowCount,
    ).toBe(0);
    await denied(as(t.fx.A, "front_desk"), CREDIT, [id], "22023", /referral_not_joined/);
    await newMember(t.fx.A, { email, loc: 1 });
    const s = await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) => tx.query(CREDIT, [id]));
    expect(s.rows[0].s).toBe("credited");
    expect(await balance(m.memberId)).toBe(200);
    await denied(as(t.fx.A, "front_desk"), CREDIT, [id], "23505", /already_credited/);
    // A second referrer of the same person cannot be credited too.
    const late = await newMember(t.fx.A);
    const id2 = (
      await asCaller(t.api, self(t.fx.A, late), (tx) => tx.query(CREATE, [late.memberId, email]))
    ).rows[0].id;
    // The person was already a member when this second referral was made → never credited (security review M2).
    await denied(as(t.fx.A, "front_desk"), CREDIT, [id2], "22023", /referral_not_joined/);
    const msgs = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.outbound_message WHERE created_at > now() - interval '1 minute' AND member_id = $1",
      [m.memberId],
    );
    expect(msgs.rows[0].n).toBe(0);
  });

  it("invalid, own and duplicate emails, minors, staff-on-behalf and abuse are refused", async () => {
    const m = await newMember(t.fx.A, { email: `yo-${randomUUID().slice(0, 6)}@demo.invalid` });
    const own = (await t.admin.query("SELECT email FROM app.person WHERE id = $1", [m.personId]))
      .rows[0].email;
    for (const e of [
      "no-arroba",
      "a@b",
      "x@y.com <script>",
      "{{x}}@demo.invalid",
      own.toUpperCase(),
    ])
      await denied(self(t.fx.A, m), CREATE, [m.memberId, e], "22023", /invalid_email/);
    await asCaller(t.api, self(t.fx.A, m), (tx) =>
      tx.query(CREATE, [m.memberId, "dup@demo.invalid"]),
    );
    await denied(self(t.fx.A, m), CREATE, [m.memberId, "DUP@demo.invalid"], "23505");
    const kid = await newMember(t.fx.A, { minor: true });
    await denied(
      self(t.fx.A, kid),
      CREATE,
      [kid.memberId, "amigo@demo.invalid"],
      "42501",
      /minor_not_allowed/,
    );
    await denied(as(t.fx.A, "front_desk"), CREATE, [m.memberId, "x1@demo.invalid"], "42501");
    await denied(as(t.fx.A, "guardian"), CREATE, [kid.memberId, "x2@demo.invalid"], "42501");
    for (let i = 0; i < 9; i++)
      await asCaller(t.api, self(t.fx.A, m), (tx) =>
        tx.query(CREATE, [m.memberId, `lote${i}@demo.invalid`]),
      );
    await denied(
      self(t.fx.A, m),
      CREATE,
      [m.memberId, "once@demo.invalid"],
      "22023",
      /referral_limit/,
    );
  });
});

describe("community wall", () => {
  const POST = "SELECT app.create_post($1, $2) AS id";
  const MOD = "SELECT app.moderate_post($1, $2) AS s";
  it("posts stay pending and invisible to other members until a moderator approves them", async () => {
    const author = await newMember(t.fx.A);
    const reader = await newMember(t.fx.A);
    const id = (
      await asCaller(t.api, self(t.fx.A, author), (tx) =>
        tx.query(POST, [author.memberId, "¡Gran clase de spinning hoy!"]),
      )
    ).rows[0].id;
    const sees = (claims: ReturnType<typeof as>) =>
      asCaller(
        t.api,
        claims,
        async (tx) =>
          (await tx.query("SELECT status FROM app.community_post WHERE id = $1", [id])).rows,
      );
    expect(await sees(self(t.fx.A, author))).toEqual([{ status: "pending" }]);
    expect(await sees(self(t.fx.A, reader))).toEqual([]);
    expect(await sees(as(t.fx.A, "trainer"))).toEqual([]);
    expect(await sees(as(t.fx.B, "member"))).toEqual([]);
    expect(await sees(as(t.fx.A, "front_desk"))).toEqual([{ status: "pending" }]);
    await denied(as(t.fx.A, "trainer"), MOD, [id, "approve"], "42501");
    await denied(self(t.fx.A, author), MOD, [id, "approve"], "42501");
    await denied(as(t.fx.B, "owner"), MOD, [id, "approve"], "42501");
    await asCaller(t.api, as(t.fx.A, "front_desk"), (tx) => tx.query(MOD, [id, "approve"]));
    expect(await sees(self(t.fx.A, reader))).toEqual([{ status: "approved" }]);
    await denied(self(t.fx.A, reader), "SELECT moderated_by FROM app.community_post", [], "42501");
    const audit = await t.admin.query(
      "SELECT actor_role FROM app.audit_log WHERE action = 'post.approved' AND entity_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ actor_role: "front_desk" }]);
    // Take-down is allowed; resurrecting a rejected post is not.
    await asCaller(t.api, as(t.fx.A, "owner"), (tx) => tx.query(MOD, [id, "reject"]));
    await denied(as(t.fx.A, "owner"), MOD, [id, "approve"], "22023", /invalid_transition/);
    expect(await sees(self(t.fx.A, reader))).toEqual([]);
  });

  it("minors, guardians and staff cannot post", async () => {
    const kid = await newMember(t.fx.A, { minor: true });
    await denied(
      self(t.fx.A, kid),
      POST,
      [kid.memberId, "Hola a todos"],
      "42501",
      /minor_cannot_post/,
    );
    await denied(as(t.fx.A, "guardian"), POST, [kid.memberId, "Hola a todos"], "42501");
    await denied(as(t.fx.A, "front_desk"), POST, [t.fx.A.members[0], "Hola a todos"], "42501");
    await denied(
      as(t.fx.A, "owner"),
      "INSERT INTO app.community_post (author_member_id, location_id, author_label, body) VALUES ($1,$2,'x','x')",
      [t.fx.A.members[0], t.fx.A.locations[0]],
      "42501",
    );
  });

  it("hostile bodies are refused (links, phones, health promises, other alphabets, oversize)", async () => {
    const m = await newMember(t.fx.A);
    for (const body of [
      "Visita gymbarato.com hoy",
      "Escríbeme al 787-555-0199",
      "Garantizado: bajar 10 libras en un mes",
      "Мой клуб лучший", // Cyrillic
      "Hola {{name}}",
      "x".repeat(501),
      "   ",
    ])
      await expect(
        asCaller(t.api, self(t.fx.A, m), (tx) => tx.query(POST, [m.memberId, body])),
        body.slice(0, 20),
      ).rejects.toMatchObject({ code: "22023" });
  });

  it("moderation is location-scoped and pending posts are capped per member", async () => {
    const atLoc1 = await newMember(t.fx.A, { loc: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        (
          await asCaller(t.api, self(t.fx.A, atLoc1), (tx) =>
            tx.query(POST, [atLoc1.memberId, `Mensaje ${i}`]),
          )
        ).rows[0].id,
      );
    await denied(self(t.fx.A, atLoc1), POST, [atLoc1.memberId, "Otro"], "22023", /post_limit/);
    await denied(as(t.fx.A, "front_desk"), MOD, [ids[0], "approve"], "42501");
    await denied(as(t.fx.A, "location_manager"), MOD, [ids[0], "approve"], "42501");
    await asCaller(t.api, as(t.fx.A, "owner"), (tx) => tx.query(MOD, [ids[0], "reject"]));
    await denied(as(t.fx.A, "owner"), MOD, [ids[1], "publish"], "22023", /invalid_decision/);
  });
});

describe("points liability (finance)", () => {
  it("owner and accountant read the outstanding total of their own org only; others are refused", async () => {
    const expected = await t.admin.query(
      "SELECT coalesce(sum(b),0)::bigint AS total FROM (SELECT greatest(sum(delta),0) AS b FROM app.points_ledger WHERE org_id = $1 GROUP BY member_id) s",
      [t.fx.B.orgId],
    );
    for (const role of ["owner", "accountant"] as Role[]) {
      const r = await asCaller(t.api, as(t.fx.B, role), (tx) =>
        tx.query("SELECT outstanding_points, members_with_balance FROM app.points_liability()"),
      );
      expect(r.rows[0].outstanding_points, role).toBe(expected.rows[0].total);
      expect(r.rows[0].members_with_balance).toBeGreaterThan(0);
    }
    for (const role of [
      "location_manager",
      "front_desk",
      "trainer",
      "member",
      "guardian",
    ] as Role[])
      await denied(as(t.fx.B, role), "SELECT * FROM app.points_liability()", [], "42501");
  });
});

describe("isolation", () => {
  it("the other organisation sees none of a member's engagement rows, even by id", async () => {
    const m = t.fx.A.members[0];
    await asCaller(t.api, as(t.fx.B, "owner"), async (tx) => {
      for (const table of ["points_ledger", "redemption", "challenge_participant", "achievement"])
        expect(
          (await tx.query(`SELECT 1 FROM app.${table} WHERE member_id = $1`, [m])).rowCount,
          table,
        ).toBe(0);
      expect(
        (await tx.query("SELECT 1 FROM app.referral WHERE referrer_member_id = $1", [m])).rowCount,
      ).toBe(0);
      expect(
        (await tx.query("SELECT 1 FROM app.community_post WHERE author_member_id = $1", [m]))
          .rowCount,
      ).toBe(0);
    });
    await denied(as(t.fx.B, "owner"), "SELECT app.points_balance($1)", [m], "42501");
  });

  it("front desk sees ledger rows of its location's members only", async () => {
    await asCaller(t.api, as(t.fx.A, "front_desk"), async (tx) => {
      const r = await tx.query(
        "SELECT DISTINCT m.home_location_id FROM app.points_ledger l JOIN app.member m ON m.id = l.member_id",
      );
      expect(r.rows.map((x) => x.home_location_id)).toEqual([t.fx.A.locations[0]]);
    });
  });
});
