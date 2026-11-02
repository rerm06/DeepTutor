/**
 * Test fixtures: an isolated database per test file, migrated exactly like production, seeded with two
 * organisations (A, B) × two locations × every role. The admin (superuser) connection is used ONLY to
 * create the database and insert fixtures; all assertions run through `withClaims` as app_api.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Claims, ROLES, type Role, STAFF_ROLES } from "@gym/shared";
import pg from "pg";
import { type Db, createPool } from "./index.js";
import { migrate } from "./migrate.js";

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://postgres@localhost:54329/postgres";

function withDb(url: string, db: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface OrgFixture {
  orgId: string;
  locations: [string, string];
  /** person id per role; staff roles are assigned to locations[0] (owner/accountant are org-wide). */
  people: Record<Role, string>;
  /** member ids: [at locations[0], at locations[1]] */
  members: [string, string];
}
export interface Fixture {
  A: OrgFixture;
  B: OrgFixture;
  /** One global Person who is a member of both A and B (spec §3.1). */
  sharedPersonId: string;
  sharedMemberIds: { A: string; B: string };
}

export interface TestDb {
  name: string;
  apiUrl: string;
  ownerUrl: string;
  adminUrl: string;
  api: Db;
  admin: pg.Client;
  fx: Fixture;
  claims(org: OrgFixture, role: Role, personId?: string): Claims;
  drop(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `gym_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const root = new pg.Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(readFileSync(join(here, "..", "bootstrap", "roles.sql"), "utf8"));
  await root.query(`CREATE DATABASE ${name} OWNER app_owner`);
  await root.end();

  const ownerUrl = withDb(ADMIN_URL, name, "app_owner", "app_owner_dev");
  const apiUrl = withDb(ADMIN_URL, name, "app_api", "app_api_dev");
  const adminUrl = withDb(ADMIN_URL, name);
  await migrate(ownerUrl, () => undefined);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const fx = await seed(admin);
  const api = createPool(apiUrl);

  const claims = (org: OrgFixture, role: Role, personId?: string): Claims => ({
    sub: personId ?? org.people[role],
    org_id: org.orgId,
    app_role: role,
    location_ids: role === "member" || role === "guardian" ? [] : [org.locations[0]],
  });

  return {
    name,
    apiUrl,
    ownerUrl,
    adminUrl,
    api,
    admin,
    fx,
    claims,
    async drop() {
      await api.end();
      await admin.end();
      const r = new pg.Client({ connectionString: ADMIN_URL });
      await r.connect();
      await r.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await r.end();
    },
  };
}

async function one(c: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await c.query<{ id: string }>(sql, params);
  const id = rows[0]?.id;
  if (!id) throw new Error(`seed failed: ${sql}`);
  return id;
}

async function seedOrg(c: pg.Client, label: string): Promise<OrgFixture> {
  const orgId = await one(c, "INSERT INTO app.organization (name) VALUES ($1) RETURNING id", [
    `Demo ${label}`,
  ]);
  const le = await one(
    c,
    "INSERT INTO app.legal_entity (org_id, legal_name) VALUES ($1, $2) RETURNING id",
    [orgId, `Demo ${label} LLC`],
  );
  const brand = await one(
    c,
    "INSERT INTO app.brand (org_id, legal_entity_id, name) VALUES ($1, $2, $3) RETURNING id",
    [orgId, le, `Demo ${label} Fitness`],
  );
  const loc = async (n: number) =>
    one(
      c,
      "INSERT INTO app.location (org_id, brand_id, legal_entity_id, name, municipality) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [orgId, brand, le, `Demo ${label} Sede ${n}`, n === 1 ? "San Juan" : "Bayamón"],
    );
  const locations: [string, string] = [await loc(1), await loc(2)];
  const person = (tag: string) =>
    one(c, "INSERT INTO app.person (email, full_name) VALUES ($1, $2) RETURNING id", [
      `${tag}.${label.toLowerCase()}@demo.invalid`,
      `Demo ${tag} ${label}`,
    ]);

  const people = {} as Record<Role, string>;
  for (const role of ROLES) people[role] = await person(role);
  for (const role of STAFF_ROLES) {
    const sm = await one(
      c,
      "INSERT INTO app.staff_member (org_id, person_id, role) VALUES ($1,$2,$3) RETURNING id",
      [orgId, people[role], role],
    );
    if (role !== "owner" && role !== "accountant") {
      await c.query(
        "INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES ($1,$2,$3)",
        [orgId, sm, locations[0]],
      );
    }
  }
  const m1 = await one(
    c,
    "INSERT INTO app.member (org_id, person_id, home_location_id, status) VALUES ($1,$2,$3,'active') RETURNING id",
    [orgId, people.member, locations[0]],
  );
  const otherPerson = await person("member2");
  const m2 = await one(
    c,
    "INSERT INTO app.member (org_id, person_id, home_location_id, status) VALUES ($1,$2,$3,'active') RETURNING id",
    [orgId, otherPerson, locations[1]],
  );
  // The guardian's ward is a minor member at location 1.
  const ward = await person("ward");
  const wardMember = await one(
    c,
    "INSERT INTO app.member (org_id, person_id, home_location_id, status) VALUES ($1,$2,$3,'active') RETURNING id",
    [orgId, ward, locations[0]],
  );
  await c.query(
    "INSERT INTO app.guardian_link (org_id, guardian_person_id, member_id) VALUES ($1,$2,$3)",
    [orgId, people.guardian, wardMember],
  );
  return { orgId, locations, people, members: [m1, m2] };
}

async function seed(c: pg.Client): Promise<Fixture> {
  const A = await seedOrg(c, "A");
  const B = await seedOrg(c, "B");
  const sharedPersonId = await one(
    c,
    "INSERT INTO app.person (email, full_name) VALUES ($1,$2) RETURNING id",
    ["shared@demo.invalid", "Demo Shared Person"],
  );
  const mA = await one(
    c,
    "INSERT INTO app.member (org_id, person_id, home_location_id, status) VALUES ($1,$2,$3,'active') RETURNING id",
    [A.orgId, sharedPersonId, A.locations[0]],
  );
  const mB = await one(
    c,
    "INSERT INTO app.member (org_id, person_id, home_location_id, status) VALUES ($1,$2,$3,'active') RETURNING id",
    [B.orgId, sharedPersonId, B.locations[0]],
  );
  return { A, B, sharedPersonId, sharedMemberIds: { A: mA, B: mB } };
}
