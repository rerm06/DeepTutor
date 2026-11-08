import { withClaims } from "@gym/db";
import { type TestDb, createTestDb } from "@gym/db/testing";
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
const auth = async (claims: Claims) => ({ authorization: `Bearer ${await token(claims)}` });

// Only client-side variables; brand, name, location and link are filled by the database.
const reminderVars = { date: "2026-11-03", time: "18:00" };
const promoVars = { discount: "20%", date: "2026-11-30" };

async function send(claims: Claims, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/messages", headers: await auth(claims), payload });
}
const reminderTo = (memberId: string, brandId = t.fx.A.brandId) => ({
  member_id: memberId,
  brand_id: brandId,
  channel: "sms",
  template_key: "class.reminder",
  locale: "es",
  vars: reminderVars,
});

/** Read an outbound row back through RLS, as the given caller (no privileged path). */
async function outbound(claims: Claims, id: string) {
  return withClaims(t.api, claims, async (tx) => {
    const { rows } = await tx.query<{ purpose: string; body: string; template_key: string }>(
      "SELECT purpose, body, template_key FROM app.outbound_message WHERE id = $1",
      [id],
    );
    return rows[0];
  });
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("server-side rendering (E8 review CRITICAL regressions)", () => {
  const fd = () => t.claims(t.fx.A, "front_desk");
  it("free text cannot be smuggled into a reminder through variables (400, nothing queued)", async () => {
    for (const vars of [
      { ...reminderVars, class_name: "Visita gymbarato.com 2x1 hoy" },
      { ...reminderVars, time: "18:00 http://evil.invalid" },
      { ...reminderVars, brand: "OtraMarca Gym" },
      { ...reminderVars, name: "x" },
      { ...reminderVars, date: "3 nov" },
    ]) {
      const r = await send(fd(), { ...reminderTo(t.fx.A.members[0]), vars });
      expect(r.statusCode, JSON.stringify(vars)).toBe(400);
    }
  });

  it("forbidden content in owner-entered names is refused by the database screen at render time", async () => {
    const loc = t.fx.A.locations[0];
    const original = (await t.admin.query("SELECT name FROM app.location WHERE id = $1", [loc]))
      .rows[0].name;
    try {
      for (const name of ["Nutricionistas Centro", "Sede 1 gymbarato.com"]) {
        await t.admin.query("UPDATE app.location SET name = $2 WHERE id = $1", [loc, name]);
        const r = await send(fd(), reminderTo(t.fx.A.members[0]));
        expect(r.statusCode, name).toBe(400);
      }
    } finally {
      await t.admin.query("UPDATE app.location SET name = $2 WHERE id = $1", [loc, original]);
    }
  });

  it("brand, first name and location come from the database", async () => {
    const r = await send(fd(), reminderTo(t.fx.A.members[0]));
    expect(r.statusCode).toBe(201);
    const row = await outbound(fd(), r.json().id);
    expect(row?.body).toBe(
      "Demo A Fitness: Hola Demo, te recordamos tu clase en Demo A Sede 1 el 2026-11-03 a las 18:00.",
    );
  });
});

describe("POST /v1/messages", () => {
  it("front desk sends a class reminder to a consenting member → queued, body rendered server-side", async () => {
    const fd = t.claims(t.fx.A, "front_desk");
    const r = await send(fd, reminderTo(t.fx.A.members[0]));
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.status).toBe("queued");
    expect(body.block_reason).toBeNull();
    expect(new Date(body.scheduled_for).getTime()).toBeGreaterThan(0);
    const row = await outbound(fd, body.id);
    expect(row?.purpose).toBe("reminder");
    expect(row?.body).toContain("2026-11-03");
  });

  it("a member without consent → stored as blocked with reason no_consent", async () => {
    // members[1] lives at locations[1]; the owner is org-wide (the front desk is scoped to locations[0]).
    const r = await send(t.claims(t.fx.A, "owner"), reminderTo(t.fx.A.members[1]));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "blocked", block_reason: "no_consent" });
  });

  it("front desk cannot message a member of another location (403)", async () => {
    const r = await send(t.claims(t.fx.A, "front_desk"), reminderTo(t.fx.A.members[1]));
    expect(r.statusCode).toBe(403);
  });

  it("marketing to a member who consented only to reminders → blocked", async () => {
    const r = await send(t.claims(t.fx.A, "front_desk"), {
      ...reminderTo(t.fx.A.members[0]),
      template_key: "promo.generic",
      vars: promoVars,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "blocked", block_reason: "no_consent" });
  });

  it("the client cannot override purpose or body (400, nothing queued)", async () => {
    const fd = t.claims(t.fx.A, "front_desk");
    const before = await withClaims(t.api, fd, async (tx) =>
      Number((await tx.query("SELECT count(*) AS n FROM app.outbound_message")).rows[0].n),
    );
    for (const extra of [
      { purpose: "transactional" },
      { body: "Texto libre" },
      { purpose: "transactional", body: "Texto libre" },
    ]) {
      const r = await send(fd, {
        ...reminderTo(t.fx.A.members[0]),
        template_key: "promo.generic",
        vars: promoVars,
        ...extra,
      });
      expect(r.statusCode).toBe(400);
    }
    const after = await withClaims(t.api, fd, async (tx) =>
      Number((await tx.query("SELECT count(*) AS n FROM app.outbound_message")).rows[0].n),
    );
    expect(after).toBe(before);
  });

  it("unknown template or missing variable → 400", async () => {
    const fd = t.claims(t.fx.A, "front_desk");
    const unknown = await send(fd, { ...reminderTo(t.fx.A.members[0]), template_key: "free.text" });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toBe("invalid_input");
    const { time: _omit, ...partial } = reminderVars;
    const missing = await send(fd, { ...reminderTo(t.fx.A.members[0]), vars: partial });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("invalid_input"); // refused by the database renderer
  });

  it("invalid input (bad uuid, channel, locale, oversized var) → 400", async () => {
    const fd = t.claims(t.fx.A, "front_desk");
    for (const patch of [
      { member_id: "nope" },
      { channel: "pigeon" },
      { locale: "fr" },
      { vars: { ...reminderVars, name: "x".repeat(201) } },
    ]) {
      expect((await send(fd, { ...reminderTo(t.fx.A.members[0]), ...patch })).statusCode).toBe(400);
    }
  });

  it("another organisation's member is never messaged (403/404, never 201)", async () => {
    const fd = t.claims(t.fx.A, "front_desk");
    const viaOwnBrand = await send(fd, reminderTo(t.fx.B.members[0]));
    expect([403, 404]).toContain(viaOwnBrand.statusCode);
    const viaTheirBrand = await send(fd, reminderTo(t.fx.B.members[0], t.fx.B.brandId));
    expect([403, 404]).toContain(viaTheirBrand.statusCode);
    const owner = await send(t.claims(t.fx.A, "owner"), reminderTo(t.fx.B.members[0]));
    expect([403, 404]).toContain(owner.statusCode);
  });

  it("another organisation's brand cannot be used for an own member (403)", async () => {
    const r = await send(
      t.claims(t.fx.A, "front_desk"),
      reminderTo(t.fx.A.members[0], t.fx.B.brandId),
    );
    expect(r.statusCode).toBe(403);
  });

  it("a trainer cannot send messages (403)", async () => {
    const r = await send(t.claims(t.fx.A, "trainer"), reminderTo(t.fx.A.members[0]));
    expect(r.statusCode).toBe(403);
  });

  it("a member cannot send messages (403)", async () => {
    const r = await send(t.claims(t.fx.A, "member"), reminderTo(t.fx.A.members[0]));
    expect(r.statusCode).toBe(403);
  });
});

describe("consents", () => {
  it("front desk lists the consents of a member at its location", async () => {
    const r = await app.inject({
      url: `/v1/members/${t.fx.A.members[0]}/consents`,
      headers: await auth(t.claims(t.fx.A, "front_desk")),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: "sms", purpose: "reminder", status: "granted" }),
      ]),
    );
  });

  it("another organisation's member's consents are invisible (empty list)", async () => {
    const r = await app.inject({
      url: `/v1/members/${t.fx.B.members[0]}/consents`,
      headers: await auth(t.claims(t.fx.A, "owner")),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
  });

  it("a grant without evidence is rejected (400)", async () => {
    const r = await app.inject({
      method: "PUT",
      url: `/v1/members/${t.fx.A.members[0]}/consents`,
      headers: await auth(t.claims(t.fx.A, "front_desk")),
      payload: {
        brand_id: t.fx.A.brandId,
        channel: "sms",
        purpose: "marketing",
        granted: true,
        source: "front_desk",
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it("evidence longer than 2000 chars is rejected (400)", async () => {
    const r = await app.inject({
      method: "PUT",
      url: `/v1/members/${t.fx.A.members[0]}/consents`,
      headers: await auth(t.claims(t.fx.A, "front_desk")),
      payload: {
        brand_id: t.fx.A.brandId,
        channel: "sms",
        purpose: "marketing",
        granted: true,
        source: "front_desk",
        evidence: "x".repeat(2001),
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it("cannot record consent for another organisation's member (403)", async () => {
    const r = await app.inject({
      method: "PUT",
      url: `/v1/members/${t.fx.B.members[0]}/consents`,
      headers: await auth(t.claims(t.fx.A, "owner")),
      payload: {
        brand_id: t.fx.A.brandId,
        channel: "sms",
        purpose: "reminder",
        granted: true,
        source: "front_desk",
        evidence: "Demo",
      },
    });
    expect(r.statusCode).toBe(403);
  });

  it("the member grants marketing consent themself; marketing is then queued", async () => {
    const put = await app.inject({
      method: "PUT",
      url: `/v1/members/${t.fx.A.members[0]}/consents`,
      headers: await auth(t.claims(t.fx.A, "member")),
      payload: {
        brand_id: t.fx.A.brandId,
        channel: "sms",
        purpose: "marketing",
        granted: true,
        source: "member_portal",
        evidence: "Demo portal checkbox v1",
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().id).toMatch(/^[0-9a-f-]{36}$/);
    const r = await send(t.claims(t.fx.A, "front_desk"), {
      ...reminderTo(t.fx.A.members[0]),
      template_key: "promo.generic",
      vars: promoVars,
    });
    expect(r.json()).toMatchObject({ status: "queued", block_reason: null });
  });
});

describe("opt-out", () => {
  it("another member cannot opt out someone else (403)", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/v1/members/${t.fx.A.members[1]}/opt-out`,
      headers: await auth(t.claims(t.fx.A, "member")),
      payload: { brand_id: t.fx.A.brandId, source: "member_portal" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("the member opts out themself; every consent is revoked and a later reminder is blocked", async () => {
    const member = t.claims(t.fx.A, "member");
    expect(member.sub).toBe(t.fx.A.people.member);
    const r = await app.inject({
      method: "POST",
      url: `/v1/members/${t.fx.A.members[0]}/opt-out`,
      headers: await auth(member),
      payload: { brand_id: t.fx.A.brandId, source: "member_portal" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().revoked).toBeGreaterThanOrEqual(1);

    const list = await app.inject({
      url: `/v1/members/${t.fx.A.members[0]}/consents`,
      headers: await auth(member),
    });
    const rows = list.json().data as { status: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((c) => c.status === "revoked")).toBe(true);

    const later = await send(t.claims(t.fx.A, "front_desk"), reminderTo(t.fx.A.members[0]));
    expect(later.statusCode).toBe(201);
    expect(later.json()).toMatchObject({ status: "blocked", block_reason: "no_consent" });
  });
});

describe("GET /v1/inbox", () => {
  it("front desk at locations[0] does not see the inbound row at locations[1]", async () => {
    const r = await app.inject({
      url: "/v1/inbox",
      headers: await auth(t.claims(t.fx.A, "front_desk")),
    });
    expect(r.statusCode).toBe(200);
    const data = r.json().data as { location_id: string }[];
    expect(data.some((m) => m.location_id === t.fx.A.locations[1])).toBe(false);
    const filtered = await app.inject({
      url: `/v1/inbox?location_id=${t.fx.A.locations[1]}`,
      headers: await auth(t.claims(t.fx.A, "front_desk")),
    });
    expect(filtered.json().data).toEqual([]);
  });

  it("the owner sees it, and never another organisation's inbox", async () => {
    const r = await app.inject({
      url: "/v1/inbox",
      headers: await auth(t.claims(t.fx.A, "owner")),
    });
    const data = r.json().data as { location_id: string; brand_id: string }[];
    expect(data.some((m) => m.location_id === t.fx.A.locations[1])).toBe(true);
    expect(data.every((m) => m.brand_id === t.fx.A.brandId)).toBe(true);
  });

  it("a member sees no inbox rows; a bad location_id is 400", async () => {
    const m = await app.inject({
      url: "/v1/inbox",
      headers: await auth(t.claims(t.fx.A, "member")),
    });
    expect(m.json().data).toEqual([]);
    const bad = await app.inject({
      url: "/v1/inbox?location_id=nope",
      headers: await auth(t.claims(t.fx.A, "owner")),
    });
    expect(bad.statusCode).toBe(400);
  });
});
