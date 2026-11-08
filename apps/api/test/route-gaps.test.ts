import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";

let t: TestDb;
let app: FastifyInstance;
let member2A: string;

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
type Org = TestDb["fx"]["A"];
const who = (org: Org, role: Role, person?: string) => t.claims(org, role, person);
async function call(claims: Claims, method: string, url: string, payload?: unknown) {
  const r = await app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${await token(claims)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return { status: r.statusCode, body: r.json() };
}
/** First column of the first row of an admin (fixture-side) query. */
async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await t.admin.query(sql, params);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no row: ${sql}`);
  return Object.values(row)[0] as string;
}
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  member2A = (
    await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [t.fx.A.members[1]])
  ).rows[0].person_id;
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

// ── Organisation, catalogue and messaging reads ──────────────────────────────────────────────────────────────
describe("org-wide reads", () => {
  it("GET /v1/brand: every role of the org reads its own brand only; no token is 401", async () => {
    const A = t.fx.A;
    for (const role of ["owner", "trainer", "member", "guardian"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/brand");
      expect(r.status, role).toBe(200);
      expect(ids(r.body.data), role).toEqual([A.brandId]);
    }
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/brand");
    expect(ids(b.body.data)).toEqual([t.fx.B.brandId]);
    const anon = await app.inject({ method: "GET", url: "/v1/brand" });
    expect(anon.statusCode).toBe(401);
  });

  it("GET /v1/locations: owner and members see every location, staff only their assigned ones", async () => {
    const A = t.fx.A;
    for (const role of ["owner", "accountant", "member"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/locations");
      expect(r.status, role).toBe(200);
      expect(ids(r.body.data).sort(), role).toEqual([...A.locations].sort());
    }
    const tr = await call(who(A, "trainer"), "GET", "/v1/locations");
    expect(ids(tr.body.data)).toEqual([A.locations[0]]);
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/locations");
    expect(ids(b.body.data)).not.toContain(A.locations[0]);
  });

  it("GET /v1/templates: the fixed platform catalogue for any caller with an org; no token is 401", async () => {
    for (const c of [who(t.fx.A, "owner"), who(t.fx.A, "member"), who(t.fx.B, "chef")]) {
      const r = await call(c, "GET", "/v1/templates");
      expect(r.status, c.app_role).toBe(200);
      expect(r.body.data.length).toBeGreaterThan(0);
      expect(
        r.body.data.some(
          (x: { key: string; locale: string }) => x.key === "class.reminder" && x.locale === "es",
        ),
      ).toBe(true);
    }
    const anon = await app.inject({ method: "GET", url: "/v1/templates" });
    expect(anon.statusCode).toBe(401);
  });
});

// ── Access (0024) ─────────────────────────────────────────────────────────────────────────────────────────────
describe("door", () => {
  it("GET /v1/door/face-access: staff list their visible locations; members get an empty list", async () => {
    const A = t.fx.A;
    const owner = await call(who(A, "owner"), "GET", "/v1/door/face-access");
    expect(owner.status).toBe(200);
    expect(owner.body.data.map((l: { location_id: string }) => l.location_id).sort()).toEqual(
      [...A.locations].sort(),
    );
    expect(owner.body.data.every((l: { face_access: boolean }) => l.face_access === false)).toBe(
      true,
    );
    const fd = await call(who(A, "front_desk"), "GET", "/v1/door/face-access");
    expect(fd.body.data.map((l: { location_id: string }) => l.location_id)).toEqual([
      A.locations[0],
    ]);
    const me = await call(who(A, "member"), "GET", "/v1/door/face-access");
    expect(me).toMatchObject({ status: 200, body: { data: [] } });
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/door/face-access");
    expect(b.body.data.map((l: { location_id: string }) => l.location_id)).not.toContain(
      A.locations[0],
    );
  });

  it("DELETE /v1/door/devices/:id: the location manager revokes a gateway of their location only", async () => {
    const A = t.fx.A;
    const created = await call(who(A, "owner"), "POST", "/v1/door/devices", {
      location_id: A.locations[0],
      name: "Puerta lateral",
      direction: "both",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    for (const c of [who(A, "front_desk"), who(A, "trainer"), who(t.fx.B, "owner")]) {
      const r = await call(c, "DELETE", `/v1/door/devices/${id}`);
      expect(r.status, c.app_role).toBe(403);
    }
    // The fixture gateway lives at the second location: out of the manager's reach.
    const fixtureDevice = await one(
      "SELECT id FROM app.door_device WHERE org_id = $1 AND name = 'Puerta principal'",
      [A.orgId],
    );
    const far = await call(
      who(A, "location_manager"),
      "DELETE",
      `/v1/door/devices/${fixtureDevice}`,
    );
    expect(far.status).toBe(403);

    const ok = await call(who(A, "location_manager"), "DELETE", `/v1/door/devices/${id}`);
    expect(ok).toMatchObject({ status: 200, body: { revoked: true } });
    const list = await call(
      who(A, "owner"),
      "GET",
      `/v1/door/devices?location_id=${A.locations[0]}`,
    );
    expect(list.body.data.find((d: { id: string }) => d.id === id).revoked_at).not.toBeNull();
    const bad = await call(who(A, "owner"), "DELETE", "/v1/door/devices/not-a-uuid");
    expect(bad.status).toBe(400);
  });
});

// ── Schedule (0007) ───────────────────────────────────────────────────────────────────────────────────────────
describe("schedule", () => {
  it("GET /v1/schedule/class-types: the whole org reads the catalogue, the other org does not", async () => {
    for (const role of ["owner", "chef", "member"] as Role[]) {
      const r = await call(who(t.fx.A, role), "GET", "/v1/schedule/class-types");
      expect(r.status, role).toBe(200);
      expect(
        r.body.data.map((c: { name: string }) => c.name),
        role,
      ).toContain("Demo Spinning");
    }
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/schedule/class-types");
    const aType = await one("SELECT id FROM app.class_type WHERE org_id = $1", [t.fx.A.orgId]);
    expect(ids(b.body.data)).not.toContain(aType);
  });

  it("GET /v1/schedule/location-policies: members see the org's policies; staff only their locations", async () => {
    const A = t.fx.A;
    const me = await call(who(A, "member"), "GET", "/v1/schedule/location-policies");
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual([
      expect.objectContaining({ location_id: A.locations[0], cancel_window_hours: 12 }),
    ]);
    const owner = await call(who(A, "owner"), "GET", "/v1/schedule/location-policies");
    expect(owner.body.data.map((p: { location_id: string }) => p.location_id)).toContain(
      A.locations[0],
    );
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/schedule/location-policies");
    expect(b.body.data.map((p: { location_id: string }) => p.location_id)).not.toContain(
      A.locations[0],
    );
  });

  it("POST /v1/schedule/sessions/:id/cancel: managers cancel a session and its bookings; others 403", async () => {
    const A = t.fx.A;
    const classType = await one("SELECT id FROM app.class_type WHERE org_id = $1", [A.orgId]);
    const session = await one(
      `INSERT INTO app.class_session (org_id, location_id, class_type_id, room, starts_at, ends_at, capacity, created_by)
       VALUES ($1, $2, $3, 'Salon Gaps', now() + interval '5 days', now() + interval '5 days 45 minutes', 5, $4)
       RETURNING id`,
      [A.orgId, A.locations[0], classType, A.people.owner],
    );
    await t.admin.query(
      "INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by) VALUES ($1, $2, $3, 'booked', $4)",
      [A.orgId, session, A.members[0], A.people.member],
    );
    for (const c of [
      who(A, "trainer"),
      who(A, "front_desk"),
      who(A, "member"),
      who(t.fx.B, "owner"),
    ]) {
      const r = await call(c, "POST", `/v1/schedule/sessions/${session}/cancel`);
      expect(r.status, c.app_role).toBe(403);
    }
    const ok = await call(
      who(A, "location_manager"),
      "POST",
      `/v1/schedule/sessions/${session}/cancel`,
    );
    expect(ok).toMatchObject({ status: 200, body: { bookings_cancelled: 1 } });
    const again = await call(who(A, "owner"), "POST", `/v1/schedule/sessions/${session}/cancel`);
    expect(again.status).toBe(400);
  });

  it("POST /v1/schedule/appointments/:id/cancel: the member cancels their own; strangers 403; twice 400", async () => {
    const A = t.fx.A;
    const trainer = await one(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2",
      [A.orgId, A.people.trainer],
    );
    const appointment = await one(
      `INSERT INTO app.appointment (org_id, location_id, kind, staff_member_id, member_id, starts_at, ends_at, created_by)
       VALUES ($1, $2, 'personal_training', $3, $4, now() + interval '6 days', now() + interval '6 days 1 hour', $5)
       RETURNING id`,
      [A.orgId, A.locations[0], trainer, A.members[0], A.people.front_desk],
    );
    for (const c of [who(A, "chef"), who(A, "member", member2A), who(t.fx.B, "owner")]) {
      const r = await call(c, "POST", `/v1/schedule/appointments/${appointment}/cancel`);
      expect(r.status, c.app_role).toBe(403);
    }
    const ok = await call(
      who(A, "member"),
      "POST",
      `/v1/schedule/appointments/${appointment}/cancel`,
    );
    expect(ok).toMatchObject({ status: 200, body: { id: appointment, status: "cancelled" } });
    const again = await call(
      who(A, "front_desk"),
      "POST",
      `/v1/schedule/appointments/${appointment}/cancel`,
    );
    expect(again.status).toBe(400);
  });
});

// ── Coach (0016) ──────────────────────────────────────────────────────────────────────────────────────────────
describe("coach", () => {
  it("GET /v1/coach/checkins: a member reads their own check-ins; staff 403; guardian of someone else 404", async () => {
    const A = t.fx.A;
    const me = await call(who(A, "member"), "GET", "/v1/coach/checkins");
    expect(me.status).toBe(200);
    expect(me.body.member_id).toBe(A.members[0]);
    expect(me.body.data).toHaveLength(1);
    expect(me.body.data[0]).toMatchObject({ pain: 5 });
    const other = await call(who(A, "member", member2A), "GET", "/v1/coach/checkins");
    expect(other.body).toMatchObject({ member_id: A.members[1], data: [] });
    for (const role of ["owner", "trainer"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/coach/checkins");
      expect(r.status, role).toBe(403);
    }
    const g = await call(who(A, "guardian"), "GET", `/v1/coach/checkins?member_id=${A.members[0]}`);
    expect(g.status).toBe(404);
  });

  it("GET /v1/coach/actions: a member reads their own proposals; staff 403", async () => {
    const A = t.fx.A;
    const me = await call(who(A, "member"), "GET", "/v1/coach/actions");
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual([
      expect.objectContaining({ tool: "add_memory", status: "proposed" }),
    ]);
    const other = await call(who(A, "member", member2A), "GET", "/v1/coach/actions");
    expect(other.body.data).toEqual([]);
    expect((await call(who(A, "owner"), "GET", "/v1/coach/actions")).status).toBe(403);
    const peek = await call(
      who(t.fx.B, "member"),
      "GET",
      `/v1/coach/actions?member_id=${A.members[0]}`,
    );
    expect(peek.status).toBe(404);
  });

  it("POST /v1/coach/escalations/:id/close: the trainer of the location closes; owner and other org 403", async () => {
    const A = t.fx.A;
    const esc = await one(
      "SELECT id FROM app.coach_escalation WHERE org_id = $1 AND member_id = $2",
      [A.orgId, A.members[0]],
    );
    for (const c of [who(A, "owner"), who(A, "front_desk"), who(t.fx.B, "trainer")]) {
      const r = await call(c, "POST", `/v1/coach/escalations/${esc}/close`, {});
      expect(r.status, c.app_role).toBe(403);
    }
    const ok = await call(who(A, "trainer"), "POST", `/v1/coach/escalations/${esc}/close`, {});
    expect(ok).toMatchObject({ status: 200, body: { id: esc, status: "closed" } });
    const again = await call(
      who(A, "location_manager"),
      "POST",
      `/v1/coach/escalations/${esc}/close`,
      {},
    );
    expect(again.status).toBe(403);
  });
});

// ── Billing (0006) ────────────────────────────────────────────────────────────────────────────────────────────
describe("billing", () => {
  it("GET /v1/billing/policy: owner and front of house read it; trainers see nothing", async () => {
    const A = t.fx.A;
    for (const role of ["owner", "location_manager", "front_desk"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/billing/policy");
      expect(r.status, role).toBe(200);
      expect(r.body.data, role).toEqual([
        expect.objectContaining({
          location_id: null,
          max_commitment_months: 0,
          invoice_due_days: 3,
        }),
      ]);
    }
    for (const role of ["trainer", "member"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/billing/policy");
      expect(r.body.data, role).toEqual([]);
    }
  });

  it("PATCH /v1/billing/products/:id: only the owner edits a product", async () => {
    const A = t.fx.A;
    const product = await one(
      "SELECT id FROM app.plan_product WHERE org_id = $1 AND name = 'Demo Sesión A'",
      [A.orgId],
    );
    const ok = await call(who(A, "owner"), "PATCH", `/v1/billing/products/${product}`, {
      name: "Demo Sesión suelta A",
      description: "Una visita",
    });
    expect(ok).toMatchObject({ status: 200, body: { id: product } });
    expect(await one("SELECT name FROM app.plan_product WHERE id = $1", [product])).toBe(
      "Demo Sesión suelta A",
    );
    for (const c of [who(A, "location_manager"), who(t.fx.B, "owner")]) {
      const r = await call(c, "PATCH", `/v1/billing/products/${product}`, { active: false });
      expect(r.status, c.app_role).toBe(404);
    }
    for (const payload of [{}, { name: "<b>x</b>" }, { kind: "drop_in" }]) {
      const r = await call(who(A, "owner"), "PATCH", `/v1/billing/products/${product}`, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
  });

  it("PATCH /v1/billing/prices/:id: owner any price; a manager only prices of their location", async () => {
    const A = t.fx.A;
    const orgWide = await one(
      `SELECT pr.id FROM app.price pr JOIN app.plan_product p ON p.id = pr.product_id
        WHERE pr.org_id = $1 AND p.kind = 'membership'`,
      [A.orgId],
    );
    const off = await call(who(A, "owner"), "PATCH", `/v1/billing/prices/${orgWide}`, {
      active: false,
    });
    expect(off).toMatchObject({ status: 200, body: { id: orgWide, active: false } });
    await call(who(A, "owner"), "PATCH", `/v1/billing/prices/${orgWide}`, { active: true });
    const lm = await call(who(A, "location_manager"), "PATCH", `/v1/billing/prices/${orgWide}`, {
      active: false,
    });
    expect(lm.status).toBe(404);

    const product = await one(
      "SELECT id FROM app.plan_product WHERE org_id = $1 AND kind = 'day_pass'",
      [A.orgId],
    );
    const local = await one(
      `INSERT INTO app.price (org_id, product_id, location_id, amount_cents, billing_interval, validity_days)
       VALUES ($1, $2, $3, 900, 'none', 1) RETURNING id`,
      [A.orgId, product, A.locations[0]],
    );
    const mine = await call(who(A, "location_manager"), "PATCH", `/v1/billing/prices/${local}`, {
      active: false,
    });
    expect(mine).toMatchObject({ status: 200, body: { active: false } });
    expect(
      (await t.admin.query("SELECT active FROM app.price WHERE id = $1", [local])).rows[0],
    ).toEqual({ active: false });
    for (const c of [who(A, "front_desk"), who(t.fx.B, "owner")]) {
      const r = await call(c, "PATCH", `/v1/billing/prices/${local}`, { active: true });
      expect(r.status, c.app_role).toBe(404);
    }
    const smuggle = await call(who(A, "owner"), "PATCH", `/v1/billing/prices/${local}`, {
      amount_cents: 1,
    });
    expect(smuggle.status).toBe(400);
  });

  it("POST /v1/invoices/:id/void: the owner voids an open invoice once; managers elsewhere 403", async () => {
    const A = t.fx.A;
    const open = await one(
      "SELECT id FROM app.invoice WHERE org_id = $1 AND status = 'open' AND member_id = $2",
      [A.orgId, A.members[1]],
    );
    const paid = await one(
      "SELECT id FROM app.invoice WHERE org_id = $1 AND status = 'paid' AND member_id = $2",
      [A.orgId, A.members[0]],
    );
    // The open invoice is at the second location: the manager of the first one cannot touch it.
    for (const c of [
      who(A, "location_manager"),
      who(A, "front_desk"),
      who(A, "accountant"),
      who(t.fx.B, "owner"),
    ]) {
      const r = await call(c, "POST", `/v1/invoices/${open}/void`, { reason: "Demo error" });
      expect(r.status, c.app_role).toBe(403);
    }
    const empty = await call(who(A, "owner"), "POST", `/v1/invoices/${open}/void`, { reason: " " });
    expect(empty.status).toBe(400);
    const ok = await call(who(A, "owner"), "POST", `/v1/invoices/${open}/void`, {
      reason: "Demo: cargo duplicado",
    });
    expect(ok).toMatchObject({ status: 200, body: { id: open, status: "void" } });
    const row = (
      await t.admin.query("SELECT status, void_reason FROM app.invoice WHERE id = $1", [open])
    ).rows[0];
    expect(row).toEqual({ status: "void", void_reason: "Demo: cargo duplicado" });
    for (const id of [open, paid]) {
      const r = await call(who(A, "owner"), "POST", `/v1/invoices/${id}/void`, {
        reason: "otra vez",
      });
      expect(r.status).toBe(400);
    }
  });
});

// ── Finance (0013) ────────────────────────────────────────────────────────────────────────────────────────────
describe("finance", () => {
  it("GET /v1/finance/recurring: readers see templates of their locations; others see none", async () => {
    const A = t.fx.A;
    for (const role of ["owner", "accountant", "location_manager"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/finance/recurring");
      expect(r.status, role).toBe(200);
      expect(r.body.data, role).toEqual([
        expect.objectContaining({
          location_id: A.locations[0],
          category: "rent",
          amount_cents: 250000,
          next_on: "2026-02-01",
        }),
      ]);
    }
    for (const c of [who(A, "front_desk"), who(A, "trainer"), who(t.fx.B, "chef")]) {
      const r = await call(c, "GET", "/v1/finance/recurring");
      expect(r.body.data, c.app_role).toEqual([]);
    }
  });

  it("GET and PATCH /v1/finance/vendors: owner edits and deactivates; inactive hidden unless asked", async () => {
    const A = t.fx.A;
    const list = await call(who(A, "accountant"), "GET", "/v1/finance/vendors");
    expect(list.status).toBe(200);
    const vendor = list.body.data.find((v: { name: string }) => v.name === "Demo Limpieza A");
    expect(vendor).toMatchObject({ contact_email: "limpieza.a@demo.invalid", active: true });
    for (const role of ["front_desk", "trainer", "member"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/finance/vendors");
      expect(r.body.data, role).toEqual([]);
    }

    for (const c of [who(A, "location_manager"), who(A, "accountant"), who(t.fx.B, "owner")]) {
      const r = await call(c, "PATCH", `/v1/finance/vendors/${vendor.id}`, { active: false });
      expect(r.status, c.app_role).toBe(404);
    }
    for (const payload of [{}, { contact_email: "no-es-correo" }, { created_by: A.people.owner }]) {
      const r = await call(who(A, "owner"), "PATCH", `/v1/finance/vendors/${vendor.id}`, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
    const ok = await call(who(A, "owner"), "PATCH", `/v1/finance/vendors/${vendor.id}`, {
      name: "Demo Limpieza Total A",
      contact_email: null,
      active: false,
    });
    expect(ok).toMatchObject({ status: 200, body: { id: vendor.id } });
    const active = await call(who(A, "owner"), "GET", "/v1/finance/vendors");
    expect(ids(active.body.data)).not.toContain(vendor.id);
    const all = await call(who(A, "owner"), "GET", "/v1/finance/vendors?include_inactive=true");
    expect(all.body.data.find((v: { id: string }) => v.id === vendor.id)).toEqual({
      id: vendor.id,
      name: "Demo Limpieza Total A",
      contact_email: null,
      active: false,
    });
    const bad = await call(who(A, "owner"), "GET", "/v1/finance/vendors?include_inactive=yes");
    expect(bad.status).toBe(400);
  });
});

// ── Store (0009) ──────────────────────────────────────────────────────────────────────────────────────────────
describe("store", () => {
  it("GET /v1/store/transfers: stock managers see transfers touching their locations", async () => {
    const A = t.fx.A;
    for (const role of ["owner", "location_manager"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/store/transfers");
      expect(r.status, role).toBe(200);
      expect(r.body.data.length, role).toBeGreaterThan(0);
      const fx = r.body.data.find(
        (x: { from_location_id: string; to_location_id: string }) =>
          x.from_location_id === A.locations[0] && x.to_location_id === A.locations[1],
      );
      expect(fx.lines).toEqual([expect.objectContaining({ qty: 4 })]);
    }
    for (const c of [who(A, "front_desk"), who(A, "accountant"), who(A, "member")]) {
      const r = await call(c, "GET", "/v1/store/transfers");
      expect(r.body.data, c.app_role).toEqual([]);
    }
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/store/transfers");
    expect(
      b.body.data.some((x: { from_location_id: string }) => x.from_location_id === A.locations[0]),
    ).toBe(false);
  });
});

// ── Member photo (0023) ───────────────────────────────────────────────────────────────────────────────────────
describe("member photo", () => {
  it("DELETE /v1/members/:id/photo: front of house who can see the member removes it; others 403", async () => {
    const A = t.fx.A;
    // members[1] (second location) has the fixture photo; the fixture front desk works at the first location.
    for (const c of [
      who(A, "front_desk"),
      who(A, "trainer"),
      who(A, "member"),
      who(t.fx.B, "owner"),
    ]) {
      const r = await call(c, "DELETE", `/v1/members/${A.members[1]}/photo`);
      expect(r.status, c.app_role).toBe(403);
    }
    const ok = await call(who(A, "owner"), "DELETE", `/v1/members/${A.members[1]}/photo`);
    expect(ok).toMatchObject({ status: 200, body: { removed: true } });
    const gone = await call(who(A, "owner"), "GET", `/v1/members/${A.members[1]}/photo`);
    expect(gone.status).toBe(404);
    const again = await call(who(A, "owner"), "DELETE", `/v1/members/${A.members[1]}/photo`);
    expect(again).toMatchObject({ status: 200, body: { removed: false } });
  });
});

// ── Engagement (0012) ─────────────────────────────────────────────────────────────────────────────────────────
describe("engagement", () => {
  it("POST /v1/engagement/rules: only the owner adds a rule; a repeated event is 409", async () => {
    const A = t.fx.A;
    // The fixture defines every event; free one so the owner can create it again.
    await t.admin.query(
      "DELETE FROM app.points_rule WHERE org_id = $1 AND event = 'comeback_bonus'",
      [A.orgId],
    );
    for (const role of ["location_manager", "front_desk"] as Role[]) {
      const r = await call(who(A, role), "POST", "/v1/engagement/rules", {
        event: "comeback_bonus",
        points: 40,
      });
      expect(r.status, role).toBe(403);
    }
    const ok = await call(who(A, "owner"), "POST", "/v1/engagement/rules", {
      event: "comeback_bonus",
      points: 40,
      active: false,
    });
    expect(ok.status).toBe(201);
    const rules = await call(who(A, "owner"), "GET", "/v1/engagement/rules");
    expect(rules.body.data.find((r: { id: string }) => r.id === ok.body.id)).toMatchObject({
      event: "comeback_bonus",
      points: 40,
      active: false,
    });
    const dup = await call(who(A, "owner"), "POST", "/v1/engagement/rules", {
      event: "visit",
      points: 12,
    });
    expect(dup.status).toBe(409);
    for (const payload of [
      { event: "birthday", points: 10 },
      { event: "visit", points: 0 },
      { event: "visit", points: 10, org_id: t.fx.B.orgId },
    ]) {
      const r = await call(who(A, "owner"), "POST", "/v1/engagement/rules", payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
  });

  it("GET /v1/engagement/rewards: front of house sees all, members only active ones, trainers none", async () => {
    const A = t.fx.A;
    const fd = await call(who(A, "front_desk"), "GET", "/v1/engagement/rewards");
    expect(fd.status).toBe(200);
    expect(fd.body.data.map((r: { name: string }) => r.name)).toEqual(
      expect.arrayContaining(["Batido Demo A", "Suplemento Demo A"]),
    );
    const me = await call(who(A, "member"), "GET", "/v1/engagement/rewards");
    expect(me.body.data.every((r: { active: boolean }) => r.active)).toBe(true);
    expect((await call(who(A, "trainer"), "GET", "/v1/engagement/rewards")).body.data).toEqual([]);
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/engagement/rewards");
    expect(b.body.data.map((r: { name: string }) => r.name)).not.toContain("Batido Demo A");
  });

  it("PATCH /v1/engagement/rewards/:id: only the owner edits; a deactivated reward disappears for members", async () => {
    const A = t.fx.A;
    const reward = await one("SELECT id FROM app.reward WHERE org_id = $1 AND name = $2", [
      A.orgId,
      "Suplemento Demo A",
    ]);
    for (const c of [who(A, "location_manager"), who(A, "front_desk"), who(t.fx.B, "owner")]) {
      const r = await call(c, "PATCH", `/v1/engagement/rewards/${reward}`, { points_cost: 1 });
      expect(r.status, c.app_role).toBe(404);
    }
    for (const payload of [{ name: "<x>" }, { points_cost: 0 }, { org_id: A.orgId }]) {
      const r = await call(who(A, "owner"), "PATCH", `/v1/engagement/rewards/${reward}`, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
    const ok = await call(who(A, "owner"), "PATCH", `/v1/engagement/rewards/${reward}`, {
      points_cost: 250,
      active: false,
    });
    expect(ok).toMatchObject({ status: 200, body: { id: reward } });
    const me = await call(who(A, "member"), "GET", "/v1/engagement/rewards");
    expect(ids(me.body.data)).not.toContain(reward);
    const fd = await call(who(A, "front_desk"), "GET", "/v1/engagement/rewards");
    expect(fd.body.data.find((r: { id: string }) => r.id === reward)).toMatchObject({
      points_cost: 250,
      active: false,
    });
  });

  it("GET /v1/engagement/redemptions: own for members, location for front desk, none for others", async () => {
    const A = t.fx.A;
    const me = await call(who(A, "member"), "GET", "/v1/engagement/redemptions");
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual([
      expect.objectContaining({
        member_id: A.members[0],
        reward_name: "Batido Demo A",
        points: 100,
        status: "requested",
      }),
    ]);
    const fd = await call(
      who(A, "front_desk"),
      "GET",
      `/v1/engagement/redemptions?status=requested&member_id=${A.members[0]}`,
    );
    expect(fd.body.data).toHaveLength(1);
    const done = await call(
      who(A, "front_desk"),
      "GET",
      "/v1/engagement/redemptions?status=fulfilled",
    );
    expect(done.body.data).toEqual([]);
    for (const c of [who(A, "member", member2A), who(A, "trainer")]) {
      const r = await call(c, "GET", "/v1/engagement/redemptions");
      expect(r.body.data, c.app_role).toEqual([]);
    }
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/engagement/redemptions");
    expect(b.body.data.some((d: { member_id: string }) => A.members.includes(d.member_id))).toBe(
      false,
    );
    const bad = await call(who(A, "owner"), "GET", "/v1/engagement/redemptions?status=paid");
    expect(bad.status).toBe(400);
  });

  it("GET /v1/engagement/challenges: members and floor staff see the org's challenges; chef none", async () => {
    const A = t.fx.A;
    for (const role of ["member", "trainer", "owner"] as Role[]) {
      const r = await call(who(A, role), "GET", "/v1/engagement/challenges");
      expect(r.status, role).toBe(200);
      expect(
        r.body.data.map((c: { name: string }) => c.name),
        role,
      ).toEqual(expect.arrayContaining(["Reto Demo Noviembre A", "Equipos Demo A"]));
    }
    expect((await call(who(A, "chef"), "GET", "/v1/engagement/challenges")).body.data).toEqual([]);
    const b = await call(who(t.fx.B, "member"), "GET", "/v1/engagement/challenges");
    expect(b.body.data.map((c: { name: string }) => c.name)).not.toContain("Equipos Demo A");
  });

  it("GET and POST /v1/engagement/challenges/:id/teams: owner adds teams to team challenges only", async () => {
    const A = t.fx.A;
    const teamChallenge = await one(
      "SELECT id FROM app.challenge WHERE org_id = $1 AND name = 'Equipos Demo A'",
      [A.orgId],
    );
    const solo = await one(
      "SELECT id FROM app.challenge WHERE org_id = $1 AND name = 'Reto Demo Noviembre A'",
      [A.orgId],
    );
    const seen = await call(
      who(A, "member"),
      "GET",
      `/v1/engagement/challenges/${teamChallenge}/teams`,
    );
    expect(seen.status).toBe(200);
    expect(seen.body.data.map((x: { name: string }) => x.name)).toEqual(["Equipo Demo Rojo"]);
    const peek = await call(
      who(t.fx.B, "owner"),
      "GET",
      `/v1/engagement/challenges/${teamChallenge}/teams`,
    );
    expect(peek).toMatchObject({ status: 200, body: { data: [] } });

    // The team challenge is org-wide: a location manager cannot add teams to it.
    for (const c of [who(A, "location_manager"), who(A, "member"), who(t.fx.B, "owner")]) {
      const r = await call(c, "POST", `/v1/engagement/challenges/${teamChallenge}/teams`, {
        name: "Equipo Azul",
      });
      expect(r.status, c.app_role).toBe(403);
    }
    const individual = await call(
      who(A, "owner"),
      "POST",
      `/v1/engagement/challenges/${solo}/teams`,
      {
        name: "Equipo Azul",
      },
    );
    expect(individual.status).toBe(403);
    const ok = await call(
      who(A, "owner"),
      "POST",
      `/v1/engagement/challenges/${teamChallenge}/teams`,
      {
        name: "Equipo Azul",
      },
    );
    expect(ok.status).toBe(201);
    const dup = await call(
      who(A, "owner"),
      "POST",
      `/v1/engagement/challenges/${teamChallenge}/teams`,
      {
        name: "equipo azul",
      },
    );
    expect(dup.status).toBe(409);
    const bad = await call(
      who(A, "owner"),
      "POST",
      `/v1/engagement/challenges/${teamChallenge}/teams`,
      {
        name: "<b>",
      },
    );
    expect(bad.status).toBe(400);
    const after = await call(
      who(A, "trainer"),
      "GET",
      `/v1/engagement/challenges/${teamChallenge}/teams`,
    );
    expect(after.body.data.map((x: { name: string }) => x.name)).toEqual([
      "Equipo Azul",
      "Equipo Demo Rojo",
    ]);
  });
});

// ── Floor (0011) ──────────────────────────────────────────────────────────────────────────────────────────────
describe("floor", () => {
  it("PATCH /v1/floor/circuits/:id: coaching staff of the location rename and deactivate; others 404", async () => {
    const A = t.fx.A;
    const circuit = await one(
      "SELECT id FROM app.circuit WHERE org_id = $1 AND name = 'Circuito Fuerza A'",
      [A.orgId],
    );
    for (const c of [who(A, "front_desk"), who(A, "member"), who(t.fx.B, "owner")]) {
      const r = await call(c, "PATCH", `/v1/floor/circuits/${circuit}`, { active: false });
      expect(r.status, c.app_role).toBe(404);
    }
    for (const payload of [{}, { name: "<b>x</b>" }, { location_id: A.locations[1] }]) {
      const r = await call(who(A, "trainer"), "PATCH", `/v1/floor/circuits/${circuit}`, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
    const off = await call(who(A, "trainer"), "PATCH", `/v1/floor/circuits/${circuit}`, {
      name: "Circuito Fuerza Demo A",
      active: false,
    });
    expect(off).toMatchObject({ status: 200, body: { id: circuit } });
    const member = await call(who(A, "member"), "GET", "/v1/floor/circuits");
    expect(ids(member.body.data)).not.toContain(circuit);
    const on = await call(who(A, "location_manager"), "PATCH", `/v1/floor/circuits/${circuit}`, {
      active: true,
    });
    expect(on.status).toBe(200);
    const back = await call(who(A, "member"), "GET", "/v1/floor/circuits");
    expect(back.body.data.find((c: { id: string }) => c.id === circuit).name).toBe(
      "Circuito Fuerza Demo A",
    );
  });

  it("PATCH /v1/floor/exercises/:id: trainers curate the library; front desk and other orgs 404", async () => {
    const A = t.fx.A;
    const exercise = await one(
      "SELECT id FROM app.exercise WHERE org_id = $1 AND name = 'Peso muerto rumano'",
      [A.orgId],
    );
    for (const c of [who(A, "front_desk"), who(A, "member"), who(t.fx.B, "trainer")]) {
      const r = await call(c, "PATCH", `/v1/floor/exercises/${exercise}`, { active: false });
      expect(r.status, c.app_role).toBe(404);
    }
    for (const payload of [
      {},
      { movement_pattern: "jump" },
      { cues: "<script>" },
      { org_id: t.fx.B.orgId },
    ]) {
      const r = await call(who(A, "trainer"), "PATCH", `/v1/floor/exercises/${exercise}`, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
    const ok = await call(who(A, "trainer"), "PATCH", `/v1/floor/exercises/${exercise}`, {
      cues: "Espalda neutra.\nCadera atrás.",
      equipment_type: "dumbbell",
    });
    expect(ok).toMatchObject({ status: 200, body: { id: exercise } });
    const lib = await call(who(A, "member"), "GET", "/v1/floor/exercises");
    expect(lib.body.data.find((e: { id: string }) => e.id === exercise)).toMatchObject({
      equipment_type: "dumbbell",
      cues: "Espalda neutra.\nCadera atrás.",
    });
  });

  it("GET /v1/floor/runs: a member reads their own runs; front desk and other orgs see none", async () => {
    const A = t.fx.A;
    const me = await call(who(A, "member"), "GET", "/v1/floor/runs");
    expect(me.status).toBe(200);
    expect(me.body.data.length).toBeGreaterThan(0);
    expect(me.body.data.every((r: { member_id: string }) => r.member_id === A.members[0])).toBe(
      true,
    );
    const trainer = await call(who(A, "trainer"), "GET", "/v1/floor/runs");
    expect(trainer.body.data.some((r: { member_id: string }) => r.member_id === A.members[0])).toBe(
      true,
    );
    for (const c of [who(A, "member", member2A), who(A, "front_desk"), who(A, "accountant")]) {
      const r = await call(c, "GET", "/v1/floor/runs");
      expect(r.body.data, c.app_role).toEqual([]);
    }
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/floor/runs");
    expect(b.body.data.some((r: { member_id: string }) => A.members.includes(r.member_id))).toBe(
      false,
    );
  });
});

// ── Health (0010) ─────────────────────────────────────────────────────────────────────────────────────────────
describe("health plan transitions", () => {
  it("POST /v1/health/plans/:id/return: an approver sends a plan in review back to draft; owner 403", async () => {
    const A = t.fx.A;
    const created = await call(who(A, "trainer"), "POST", "/v1/health/plans", {
      member_id: A.members[0],
      kind: "training",
      title: "Demo plan para devolver",
      body: { sections: [{ heading: "Semana 1", items: ["Caminata 20 minutos"] }] },
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const early = await call(
      who(A, "location_manager"),
      "POST",
      `/v1/health/plans/${id}/return`,
      {},
    );
    expect(early).toMatchObject({ status: 403, body: { reason: "invalid_transition" } });
    const sub = await call(who(A, "trainer"), "POST", `/v1/health/plans/${id}/submit`, {});
    expect(sub.body.status).toBe("review");
    for (const c of [
      who(A, "owner"),
      who(A, "nutritionist"),
      who(A, "front_desk"),
      who(t.fx.B, "trainer"),
    ]) {
      const r = await call(c, "POST", `/v1/health/plans/${id}/return`, {});
      expect(r.status, c.app_role).toBe(403);
    }
    const smuggle = await call(
      who(A, "location_manager"),
      "POST",
      `/v1/health/plans/${id}/return`,
      {
        status: "approved",
      },
    );
    expect(smuggle.status).toBe(400);
    const ok = await call(who(A, "location_manager"), "POST", `/v1/health/plans/${id}/return`, {});
    expect(ok).toMatchObject({ status: 200, body: { id, status: "draft" } });
  });

  it("POST /v1/health/plans/:id/archive: the owner archives a published plan once; others 403", async () => {
    const A = t.fx.A;
    const plan = await one(
      "SELECT id FROM app.care_plan WHERE org_id = $1 AND status = 'published' AND title = 'Demo plan de fuerza inicial'",
      [A.orgId],
    );
    for (const c of [
      who(A, "front_desk"),
      who(A, "nutritionist"),
      who(A, "member"),
      who(t.fx.B, "owner"),
    ]) {
      const r = await call(c, "POST", `/v1/health/plans/${plan}/archive`, {});
      expect(r.status, c.app_role).toBe(403);
    }
    const ok = await call(who(A, "owner"), "POST", `/v1/health/plans/${plan}/archive`, {});
    expect(ok).toMatchObject({ status: 200, body: { id: plan, status: "archived" } });
    const again = await call(who(A, "trainer"), "POST", `/v1/health/plans/${plan}/archive`, {});
    expect(again).toMatchObject({ status: 403, body: { reason: "invalid_transition" } });
  });
});
