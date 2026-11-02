import { randomUUID } from "node:crypto";
import { type OrgFixture, type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";

let t: TestDb;
let app: FastifyInstance;

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
async function call(
  claims: Claims,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/v1/engagement${url}`,
    headers: { authorization: `Bearer ${await token(claims)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
/** Dates relative to today so the suite never rots. */
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const as = (org: OrgFixture, role: Claims["app_role"], personId?: string) =>
  t.claims(org, role, personId);

async function newMember(
  org: OrgFixture,
  opts: { minor?: boolean; loc?: 0 | 1; email?: string } = {},
) {
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [opts.email ?? `api-eng-${randomUUID().slice(0, 8)}@demo.invalid`],
  );
  const personId = p.rows[0]?.id as string;
  const m = await t.admin.query<{ id: string }>(
    `INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status)
     VALUES ($1,$2,$3,'Demo Api Socio','active') RETURNING id`,
    [org.orgId, personId, org.locations[opts.loc ?? 0]],
  );
  const memberId = m.rows[0]?.id as string;
  if (opts.minor)
    await t.admin.query(
      "INSERT INTO app.guardian_link (org_id, guardian_person_id, member_id) VALUES ($1,$2,$3)",
      [org.orgId, org.people.guardian, memberId],
    );
  return { memberId, claims: as(org, "member", personId) };
}
async function give(org: OrgFixture, memberId: string, points: number) {
  await t.admin.query(
    `INSERT INTO app.points_ledger (org_id, member_id, delta, reason, note, created_by)
     VALUES ($1,$2,$3,'manual','Demo api',$4)`,
    [org.orgId, memberId, points, org.people.owner],
  );
}
async function rewardId(org: OrgFixture, restricted: boolean): Promise<string> {
  const r = await t.admin.query(
    "SELECT id FROM app.reward WHERE org_id = $1 AND restricted_for_minors = $2 AND active ORDER BY points_cost LIMIT 1",
    [org.orgId, restricted],
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("points", () => {
  it("front desk awards a visit; the member reads balance, weekly streak, history and badges", async () => {
    const m = await newMember(t.fx.A);
    const r = await call(as(t.fx.A, "front_desk"), "POST", `/members/${m.memberId}/award`, {
      event: "visit",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ points: 10 });
    const again = await call(as(t.fx.A, "front_desk"), "POST", `/members/${m.memberId}/award`, {
      event: "visit",
    });
    expect(again.statusCode).toBe(409);
    const mine = await call(m.claims, "GET", `/members/${m.memberId}/points`);
    expect(mine.statusCode).toBe(200);
    const body = mine.json();
    expect(body.balance).toBe(10);
    expect(body.weekly_streak).toBe(1);
    expect(body.history.map((h: { reason: string }) => h.reason)).toEqual(["visit"]);
    expect(body.achievements.map((a: { code: string }) => a.code)).toEqual(["first_visit"]);
  });

  it("system events, unknown fields and bad references are 400; trainer and other org are 403", async () => {
    const m = await newMember(t.fx.A);
    const fd = as(t.fx.A, "front_desk");
    for (const payload of [
      { event: "challenge_goal" },
      { event: "visit", points: 999 },
      { event: "class", ref: "a b" },
    ]) {
      const r = await call(fd, "POST", `/members/${m.memberId}/award`, payload);
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(
      (
        await call(as(t.fx.A, "trainer"), "POST", `/members/${m.memberId}/award`, {
          event: "visit",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(as(t.fx.B, "owner"), "POST", `/members/${m.memberId}/award`, { event: "visit" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(as(t.fx.B, "owner"), "GET", `/members/${m.memberId}/points`)).statusCode,
    ).toBe(403);
    expect(
      (await call(as(t.fx.A, "trainer"), "GET", `/members/${m.memberId}/points`)).statusCode,
    ).toBe(403);
    const bal = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.points_ledger WHERE member_id = $1",
      [m.memberId],
    );
    expect(bal.rows[0].n).toBe(0);
  });

  it("manual points need a reason; a correction cannot overdraw (409 with reason)", async () => {
    const m = await newMember(t.fx.A);
    const fd = as(t.fx.A, "front_desk");
    expect(
      (await call(fd, "POST", `/members/${m.memberId}/manual`, { delta: 20 })).statusCode,
    ).toBe(400);
    expect(
      (await call(fd, "POST", `/members/${m.memberId}/manual`, { delta: 20, note: "Demo <b>" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(fd, "POST", `/members/${m.memberId}/manual`, { delta: 20, note: "Demo evento" }))
        .statusCode,
    ).toBe(201);
    const over = await call(fd, "POST", `/members/${m.memberId}/manual`, {
      delta: -21,
      note: "Demo corrección",
    });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toEqual({ error: "conflict", reason: "insufficient_points" });
  });

  it("liability: accountant reads the total; front desk is refused", async () => {
    const r = await call(as(t.fx.A, "accountant"), "GET", "/liability");
    expect(r.statusCode).toBe(200);
    expect(r.json().outstanding_points).toBeGreaterThan(0);
    expect((await call(as(t.fx.A, "front_desk"), "GET", "/liability")).statusCode).toBe(403);
    // The accountant never reads individual ledger rows.
    const ledger = await call(as(t.fx.A, "accountant"), "GET", "/ledger");
    expect(ledger.json().data).toEqual([]);
  });

  it("rules: owner edits, front desk cannot (404: no visible-writable row), members see active ones", async () => {
    const rules = await call(as(t.fx.A, "owner"), "GET", "/rules");
    const visit = rules.json().data.find((r: { event: string }) => r.event === "visit");
    expect(
      (await call(as(t.fx.A, "front_desk"), "PATCH", `/rules/${visit.id}`, { points: 999 }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call(as(t.fx.A, "owner"), "PATCH", `/rules/${visit.id}`, {
          points: 10,
          event: "class",
        })
      ).statusCode,
    ).toBe(400);
    const r = await call(as(t.fx.A, "owner"), "PATCH", `/rules/${visit.id}`, { points: 10 });
    expect(r.statusCode).toBe(200);
    expect((await call(as(t.fx.A, "member"), "GET", "/rules")).json().data.length).toBe(6);
  });
});

describe("rewards and redemptions", () => {
  it("member redeems; front desk fulfils; a restricted reward is refused for a minor (403 with reason)", async () => {
    const m = await newMember(t.fx.A);
    await give(t.fx.A, m.memberId, 120);
    const r = await call(m.claims, "POST", "/redemptions", {
      member_id: m.memberId,
      reward_id: await rewardId(t.fx.A, false),
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    const poor = await call(m.claims, "POST", "/redemptions", {
      member_id: m.memberId,
      reward_id: await rewardId(t.fx.A, false),
    });
    expect(poor.json()).toEqual({ error: "conflict", reason: "insufficient_points" });
    const list = await call(
      as(t.fx.A, "front_desk"),
      "GET",
      `/redemptions?status=requested&member_id=${m.memberId}`,
    );
    expect(list.json().data.map((x: { id: string }) => x.id)).toEqual([id]);
    expect(
      (await call(as(t.fx.A, "front_desk"), "PATCH", `/redemptions/${id}`, { status: "fulfilled" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(as(t.fx.A, "front_desk"), "PATCH", `/redemptions/${id}`, { status: "cancelled" }))
        .statusCode,
    ).toBe(409);

    const kid = await newMember(t.fx.A, { minor: true });
    await give(t.fx.A, kid.memberId, 1000);
    const refused = await call(kid.claims, "POST", "/redemptions", {
      member_id: kid.memberId,
      reward_id: await rewardId(t.fx.A, true),
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().reason).toBe("restricted_for_minors");
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.redemption WHERE member_id = $1",
      [kid.memberId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("cash rewards and other org's data are refused", async () => {
    expect(
      (
        await call(as(t.fx.A, "owner"), "POST", "/rewards", {
          name: "Premio en efectivo",
          points_cost: 10,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(as(t.fx.A, "front_desk"), "POST", "/rewards", {
          name: "Toalla Demo",
          points_cost: 10,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(as(t.fx.A, "owner"), "POST", "/rewards", {
          name: "Toalla Demo",
          points_cost: 10,
        })
      ).statusCode,
    ).toBe(201);
    const m = await newMember(t.fx.A);
    await give(t.fx.A, m.memberId, 1000);
    const cross = await call(as(t.fx.B, "owner"), "POST", "/redemptions", {
      member_id: m.memberId,
      reward_id: await rewardId(t.fx.B, false),
    });
    expect(cross.statusCode).toBe(403);
  });
});

describe("challenges and leaderboard", () => {
  it("owner creates; member joins (not listed by default); leaderboard hides non-opted-in members", async () => {
    const owner = as(t.fx.A, "owner");
    const created = await call(owner, "POST", "/challenges", {
      name: "Reto Api Demo",
      kind: "individual",
      metric: "visits",
      starts_on: day(-1),
      ends_on: day(30),
      goal: 10,
    });
    expect(created.statusCode).toBe(201);
    const cid = created.json().id;
    expect(
      (
        await call(as(t.fx.A, "front_desk"), "POST", "/challenges", {
          name: "X Demo",
          kind: "individual",
          metric: "visits",
          starts_on: day(-1),
          ends_on: day(30),
          goal: 1,
        })
      ).statusCode,
    ).toBe(403);
    const a = await newMember(t.fx.A);
    const b = await newMember(t.fx.A);
    expect(
      (
        await call(a.claims, "POST", `/challenges/${cid}/join`, {
          member_id: a.memberId,
          show_on_leaderboard: true,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(b.claims, "POST", `/challenges/${cid}/join`, { member_id: b.memberId }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call(b.claims, "POST", `/challenges/${cid}/join`, { member_id: a.memberId }))
        .statusCode,
    ).toBe(403);
    const board = await call(as(t.fx.A, "trainer"), "GET", `/challenges/${cid}/leaderboard`);
    expect(board.statusCode).toBe(200);
    expect(board.json().data).toHaveLength(1);
    const parts = await call(as(t.fx.A, "front_desk"), "GET", `/challenges/${cid}/participants`);
    expect(parts.json().data).toHaveLength(2);
    expect(
      (await call(as(t.fx.A, "trainer"), "GET", `/challenges/${cid}/participants`)).json().data,
    ).toEqual([]);
    expect(
      (await call(as(t.fx.B, "owner"), "GET", `/challenges/${cid}/leaderboard`)).statusCode,
    ).toBe(403);
    expect(
      (await call(as(t.fx.A, "accountant"), "GET", `/challenges/${cid}/leaderboard`)).statusCode,
    ).toBe(403);
    const prefs = await call(b.claims, "PUT", `/challenges/${cid}/preferences`, {
      member_id: b.memberId,
      show_on_leaderboard: true,
      compare_mode: "ranked",
    });
    expect(prefs.statusCode).toBe(200);
    expect((await call(owner, "GET", `/challenges/${cid}/leaderboard`)).json().data).toHaveLength(
      2,
    );
    const kid = await newMember(t.fx.A, { minor: true });
    const minor = await call(kid.claims, "POST", `/challenges/${cid}/join`, {
      member_id: kid.memberId,
      show_on_leaderboard: true,
    });
    expect(minor.statusCode).toBe(403);
    expect(minor.json().reason).toBe("minor_not_listed");
  });
});

describe("referrals", () => {
  it("member refers by email (pending, nothing sent); front desk credits after the invitee joins", async () => {
    const m = await newMember(t.fx.A);
    const email = `ref-${randomUUID().slice(0, 6)}@demo.invalid`;
    const r = await call(m.claims, "POST", "/referrals", { member_id: m.memberId, email });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    expect(
      (await call(m.claims, "GET", "/referrals"))
        .json()
        .data.map((x: { status: string }) => x.status),
    ).toEqual(["pending"]);
    const early = await call(as(t.fx.A, "front_desk"), "POST", `/referrals/${id}/credit`);
    expect(early.json()).toEqual({ error: "conflict", reason: "referral_not_joined" });
    await newMember(t.fx.A, { email });
    const ok = await call(as(t.fx.A, "front_desk"), "POST", `/referrals/${id}/credit`);
    expect(ok.json()).toEqual({ id, status: "credited" });
    expect(
      (await call(m.claims, "POST", "/referrals", { member_id: m.memberId, email: "bad" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(as(t.fx.A, "front_desk"), "POST", "/referrals", {
          member_id: m.memberId,
          email: "x@demo.invalid",
        })
      ).statusCode,
    ).toBe(403);
    const sent = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.outbound_message WHERE member_id = $1",
      [m.memberId],
    );
    expect(sent.rows[0].n).toBe(0);
  });
});

describe("community wall", () => {
  it("pending posts are invisible to other members until approved; minors cannot post", async () => {
    const author = await newMember(t.fx.A);
    const reader = await newMember(t.fx.A);
    const r = await call(author.claims, "POST", "/posts", {
      member_id: author.memberId,
      body: "¡Gracias por la clase de hoy!",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("pending");
    const id = r.json().id;
    const ids = async (claims: Claims) =>
      (await call(claims, "GET", "/posts")).json().data.map((p: { id: string }) => p.id);
    expect(await ids(reader.claims)).not.toContain(id);
    expect(await ids(author.claims)).toContain(id);
    const queue = await call(as(t.fx.A, "front_desk"), "GET", "/posts?status=pending");
    expect(queue.json().data.map((p: { id: string }) => p.id)).toContain(id);
    expect(
      (await call(as(t.fx.A, "trainer"), "POST", `/posts/${id}/moderate`, { decision: "approve" }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(as(t.fx.A, "front_desk"), "POST", `/posts/${id}/moderate`, {
          decision: "approve",
        })
      ).json(),
    ).toEqual({ id, status: "approved" });
    expect(await ids(reader.claims)).toContain(id);
    expect(await ids(as(t.fx.B, "member"))).not.toContain(id);

    const kid = await newMember(t.fx.A, { minor: true });
    const refused = await call(kid.claims, "POST", "/posts", {
      member_id: kid.memberId,
      body: "Hola",
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().reason).toBe("minor_cannot_post");
    const link = await call(author.claims, "POST", "/posts", {
      member_id: author.memberId,
      body: "Oferta en gymbarato.com",
    });
    expect(link.json()).toEqual({ error: "invalid_input", reason: "forbidden_content" });
    expect(
      (
        await call(author.claims, "POST", "/posts", {
          member_id: author.memberId,
          body: "x",
          status: "approved",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("requires authentication", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/engagement/posts" });
    expect(r.statusCode).toBe(401);
  });
});
