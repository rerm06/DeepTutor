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

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
async function call(role: Role, method: string, url: string, payload?: unknown, org = t.fx.A) {
  const claims = t.claims(org, role);
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${await token(claims)}` },
    payload: payload as Record<string, unknown> | undefined,
  });
}
async function staffId(role: Role, org = t.fx.A): Promise<string> {
  const { rows } = await t.admin.query<{ id: string }>(
    "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = $3",
    [org.orgId, org.people[role], role],
  );
  return rows[0]?.id as string;
}
let seq = 0;
async function createLead(role: Role = "front_desk", extra: Record<string, unknown> = {}) {
  const r = await call(role, "POST", "/v1/crm/leads", {
    location_id: t.fx.A.locations[0],
    source: "instagram",
    full_name: `Demo Api Lead ${++seq}`,
    email: `api.lead.${seq}@demo.invalid`,
    phone: "+1 787 555 0123",
    ...extra,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("leads API", () => {
  it("front desk creates, lists, moves and annotates a lead; the stage change shows in the timeline", async () => {
    const id = await createLead();
    const list = await call("front_desk", "GET", "/v1/crm/leads");
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((l: { id: string }) => l.id)).toContain(id);

    const moved = await call("front_desk", "PATCH", `/v1/crm/leads/${id}`, { stage: "contacted" });
    expect(moved.json()).toEqual({ id, stage: "contacted" });
    const note = await call("front_desk", "POST", `/v1/crm/leads/${id}/activities`, {
      kind: "call",
      body: "Demo: llamada, interesada en horario de mañana",
    });
    expect(note.statusCode).toBe(201);

    const detail = await call("front_desk", "GET", `/v1/crm/leads/${id}`);
    expect(detail.statusCode).toBe(200);
    const kinds = detail
      .json()
      .activities.map((a: { kind: string }) => a.kind)
      .sort();
    expect(kinds).toEqual(["call", "stage_change"]);
  });

  it("strict bodies: unknown fields, 'won', member_id and control characters are 400; nothing written", async () => {
    const id = await createLead();
    for (const body of [
      { stage: "won" },
      { member_id: t.fx.A.members[0] },
      { stage: "contacted", created_by: t.fx.A.people.owner },
      { full_name: "Demo\nInyectado" },
      {},
    ]) {
      const r = await call("front_desk", "PATCH", `/v1/crm/leads/${id}`, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    const bad = await call("front_desk", "POST", "/v1/crm/leads", {
      location_id: t.fx.A.locations[0],
      source: "web",
      full_name: "Demo Sin Contacto",
    });
    expect(bad.statusCode).toBe(400);
    const extra = await call("front_desk", "POST", "/v1/crm/leads", {
      location_id: t.fx.A.locations[0],
      source: "web",
      full_name: "Demo X",
      phone: "7875550100",
      stage: "trial",
    });
    expect(extra.statusCode).toBe(400);
    const row = await t.admin.query("SELECT stage, member_id FROM app.lead WHERE id = $1", [id]);
    expect(row.rows[0]).toEqual({ stage: "new", member_id: null });
  });

  it("'lost' without a reason is 400; with a reason it is stored", async () => {
    const id = await createLead();
    expect(
      (await call("front_desk", "PATCH", `/v1/crm/leads/${id}`, { stage: "lost" })).statusCode,
    ).toBe(400);
    const ok = await call("front_desk", "PATCH", `/v1/crm/leads/${id}`, {
      stage: "lost",
      lost_reason: "Demo: precio",
    });
    expect(ok.json().stage).toBe("lost");
  });

  it("trainer, accountant, chef, clinician, member: 403 on create, empty lists, 404 on detail", async () => {
    const id = await createLead();
    for (const role of [
      "trainer",
      "accountant",
      "chef",
      "clinician",
      "nutritionist",
      "member",
      "guardian",
    ] as Role[]) {
      const create = await call(role, "POST", "/v1/crm/leads", {
        location_id: t.fx.A.locations[0],
        source: "web",
        full_name: "Demo X",
        phone: "7875550100",
      });
      expect(create.statusCode, role).toBe(403);
      expect((await call(role, "GET", "/v1/crm/leads")).json().data, role).toEqual([]);
      expect((await call(role, "GET", `/v1/crm/leads/${id}`)).statusCode, role).toBe(404);
      expect((await call(role, "POST", `/v1/crm/leads/${id}/convert`)).statusCode, role).toBe(404);
    }
  });

  it("other location and other org: 404 (indistinguishable from missing), 403 on create", async () => {
    const owner = await call("owner", "POST", "/v1/crm/leads", {
      location_id: t.fx.A.locations[1],
      source: "walk_in",
      full_name: "Demo Sede Dos",
      phone: "7875550100",
    });
    const elsewhere = owner.json().id as string;
    expect((await call("front_desk", "GET", `/v1/crm/leads/${elsewhere}`)).statusCode).toBe(404);
    expect(
      (await call("front_desk", "PATCH", `/v1/crm/leads/${elsewhere}`, { stage: "contacted" }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call("owner", "GET", `/v1/crm/leads/${elsewhere}`, undefined, t.fx.B)).statusCode,
    ).toBe(404);
    expect(
      (await call("owner", "POST", `/v1/crm/leads/${elsewhere}/convert`, undefined, t.fx.B))
        .statusCode,
    ).toBe(404);
    const create = await call("front_desk", "POST", "/v1/crm/leads", {
      location_id: t.fx.A.locations[1],
      source: "web",
      full_name: "Demo X",
      phone: "7875550100",
    });
    expect(create.statusCode).toBe(403);
  });
});

describe("conversion API", () => {
  it("converts once (201 + member visible in /members), the second time is 409; exactly one member", async () => {
    const id = await createLead("front_desk", { email: "api.convert@demo.invalid" });
    const first = await call("front_desk", "POST", `/v1/crm/leads/${id}/convert`);
    expect(first.statusCode).toBe(201);
    const memberId = first.json().member_id as string;
    const second = await call("front_desk", "POST", `/v1/crm/leads/${id}/convert`);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "conflict" });

    const members = (await call("front_desk", "GET", "/v1/members")).json().data as Array<{
      id: string;
      email: string;
    }>;
    expect(members.filter((m) => m.email === "api.convert@demo.invalid").map((m) => m.id)).toEqual([
      memberId,
    ]);
    const lead = (await call("front_desk", "GET", `/v1/crm/leads/${id}`)).json();
    expect(lead).toMatchObject({ stage: "won", member_id: memberId });
    // No consent is created by capture or conversion.
    expect(
      (await call("front_desk", "GET", `/v1/members/${memberId}/consents`)).json().data,
    ).toEqual([]);
  });

  it("a lead without email cannot be converted (400)", async () => {
    const r = await call("front_desk", "POST", "/v1/crm/leads", {
      location_id: t.fx.A.locations[0],
      source: "walk_in",
      full_name: "Demo Solo Telefono",
      phone: "7875550100",
    });
    const conv = await call("front_desk", "POST", `/v1/crm/leads/${r.json().id}/convert`);
    expect(conv.statusCode).toBe(400);
  });
});

describe("tasks API", () => {
  it("front desk assigns a task to the trainer; the trainer sees only their own and completes it", async () => {
    const trainer = await staffId("trainer");
    const created = await call("front_desk", "POST", "/v1/crm/tasks", {
      location_id: t.fx.A.locations[0],
      title: "Demo: llamar para renovar",
      due_at: "2026-11-05T14:00:00-04:00",
      assigned_staff_id: trainer,
      member_id: t.fx.A.members[0],
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;

    const list = (await call("trainer", "GET", "/v1/crm/tasks")).json().data as Array<{
      id: string;
      assigned_staff_id: string;
    }>;
    expect(list.map((x) => x.id)).toContain(id);
    for (const x of list) expect(x.assigned_staff_id).toBe(trainer);

    expect((await call("trainer", "PATCH", `/v1/crm/tasks/${id}`, { title: "x" })).statusCode).toBe(
      403,
    );
    const done = await call("trainer", "PATCH", `/v1/crm/tasks/${id}`, { status: "done" });
    expect(done.json()).toEqual({ id, status: "done" });

    const forMember = (
      await call("front_desk", "GET", `/v1/crm/tasks?member_id=${t.fx.A.members[0]}`)
    ).json().data;
    expect(forMember.map((x: { id: string }) => x.id)).toContain(id);
  });

  it("'mine' filters to the caller; front desk cannot see another location's tasks", async () => {
    const fd = await staffId("front_desk");
    const mine = (await call("front_desk", "GET", "/v1/crm/tasks?mine=true")).json().data as Array<{
      assigned_staff_id: string;
    }>;
    expect(mine.length).toBeGreaterThan(0);
    for (const x of mine) expect(x.assigned_staff_id).toBe(fd);
    const all = (await call("front_desk", "GET", "/v1/crm/tasks")).json().data as Array<{
      location_id: string;
    }>;
    for (const x of all) expect(x.location_id).toBe(t.fx.A.locations[0]);
  });

  it("refuses bad task bodies (400) and roles without task access (403 / empty)", async () => {
    const fd = await staffId("front_desk");
    const base = {
      location_id: t.fx.A.locations[0],
      title: "Demo",
      due_at: "2026-11-05T14:00:00Z",
      assigned_staff_id: fd,
    };
    for (const body of [
      { ...base, due_at: "mañana" },
      { ...base, lead_id: t.fx.A.members[0], member_id: t.fx.A.members[0] },
      { ...base, status: "done" },
      { ...base, assigned_staff_id: await staffId("front_desk", t.fx.B) },
    ]) {
      expect(
        (await call("front_desk", "POST", "/v1/crm/tasks", body)).statusCode,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect((await call("accountant", "POST", "/v1/crm/tasks", base)).statusCode).toBe(403);
    expect((await call("chef", "GET", "/v1/crm/tasks")).json().data).toEqual([]);
    expect((await call("member", "GET", "/v1/crm/tasks")).json().data).toEqual([]);
  });
});

describe("funnel and staff API", () => {
  it("owner gets the fixture cohort; location manager only their location; front desk 403", async () => {
    const q = "/v1/crm/funnel?from=2025-06-01&to=2025-06-30";
    const owner = (await call("owner", "GET", q)).json().data as Array<Record<string, unknown>>;
    expect(owner).toHaveLength(3);
    expect(owner.find((r) => r.source === "web")).toMatchObject({
      location_id: t.fx.A.locations[0],
      total: 3,
      won: 1,
      conversion_pct: 33.3,
    });
    const lm = (await call("location_manager", "GET", q)).json().data as Array<{
      location_id: string;
    }>;
    expect(lm.length).toBe(2);
    for (const r of lm) expect(r.location_id).toBe(t.fx.A.locations[0]);
    expect((await call("front_desk", "GET", q)).statusCode).toBe(403);
    expect(
      (await call("owner", "GET", "/v1/crm/funnel?from=2025-06-30&to=2025-06-01")).statusCode,
    ).toBe(400);
    expect((await call("owner", "GET", "/v1/crm/funnel?from=junio&to=2025-06-01")).statusCode).toBe(
      400,
    );
  });

  it("assignable staff: active staff of that location; nothing for trainers", async () => {
    const r = (
      await call("front_desk", "GET", `/v1/crm/staff?location_id=${t.fx.A.locations[0]}`)
    ).json().data as Array<{
      id: string;
      role: string;
    }>;
    expect(r.map((s) => s.role)).toContain("trainer");
    expect(r.map((s) => s.role)).toContain("owner");
    expect(r.map((s) => s.role)).not.toContain("chef");
    const owners = (
      await call(
        "front_desk",
        "GET",
        `/v1/crm/staff?location_id=${t.fx.A.locations[0]}&purpose=lead`,
      )
    ).json().data as Array<{ role: string }>;
    expect(owners.map((s) => s.role).sort()).toEqual(["front_desk", "location_manager", "owner"]);
    expect(
      (await call("trainer", "GET", `/v1/crm/staff?location_id=${t.fx.A.locations[0]}`)).json()
        .data,
    ).toEqual([]);
  });
});
