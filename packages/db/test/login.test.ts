import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Staff password sign-in, forced first change, lockout, refresh rotation, owner-created accounts (0026).
let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const as = (role: Role, org: OrgFixture = t.fx.A) => t.claims(org, role);
async function refused(tx: Tx, sql: string, params: unknown[], code: string, msg?: string) {
  await tx.query("SAVEPOINT r");
  await expect(tx.query(sql, params)).rejects.toMatchObject(
    msg ? { code, message: msg } : { code },
  );
  await tx.query("ROLLBACK TO SAVEPOINT r");
}
type R = {
  ok: boolean;
  must_change?: boolean;
  locked?: boolean;
  weak?: boolean;
  refresh?: string;
  claims?: { role: string; org_id: string; location_ids: string[]; display_name: string };
};
const login = async (email: string, pw: string) =>
  (await t.api.pool.query<{ r: R }>("SELECT app_public.password_login($1, $2) AS r", [email, pw]))
    .rows[0]?.r as R;
const change = async (email: string, pw: string, next: string) =>
  (
    await t.api.pool.query<{ r: R }>("SELECT app_public.password_change($1, $2, $3) AS r", [
      email,
      pw,
      next,
    ])
  ).rows[0]?.r as R;
const create = (email: string, role: Role, loc: string | null, pw = "Password") =>
  asCaller(
    t.api,
    as("owner"),
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "SELECT app.create_staff_account($1, $2, $3, $4, $5) AS id",
          [email, "Nueva Persona", role, loc, pw],
        )
      ).rows[0]?.id,
  );

describe("owner creates accounts", () => {
  it("only the owner; new e-mails only; location roles need a location", async () => {
    await asCaller(t.api, as("location_manager"), (tx) =>
      refused(
        tx,
        "SELECT app.create_staff_account('x@ejemplo.com', 'X Y', 'owner', NULL, 'Password')",
        [],
        "42501",
      ),
    );
    expect(await create("Duena.Uno@Ejemplo.com", "owner", null)).toBeTruthy();
    await asCaller(t.api, as("owner"), async (tx) => {
      await refused(
        tx,
        "SELECT app.create_staff_account('duena.uno@ejemplo.com', 'Otra', 'owner', NULL, 'Password')",
        [],
        "23505",
        "account_exists",
      );
      await refused(
        tx,
        "SELECT app.create_staff_account('recep@ejemplo.com', 'Recep', 'front_desk', NULL, 'Password')",
        [],
        "22023",
        "location_required",
      );
      await refused(
        tx,
        "SELECT app.create_staff_account('no-es-correo', 'Recep', 'owner', NULL, 'Password')",
        [],
        "22023",
        "invalid_email",
      );
      await refused(
        tx,
        "SELECT app.create_staff_account('m@ejemplo.com', 'Socio', 'member', NULL, 'Password')",
        [],
        "22023",
        "invalid_role",
      );
    });
  });

  it("the owner sees the team with password status; nobody else does", async () => {
    const rows = await asCaller(
      t.api,
      as("owner"),
      async (tx) =>
        (
          await tx.query<{ email: string; has_password: boolean; must_change: boolean }>(
            "SELECT email, has_password, must_change FROM app.staff_accounts()",
          )
        ).rows,
    );
    expect(rows.find((r) => r.email === "duena.uno@ejemplo.com")).toMatchObject({
      has_password: true,
      must_change: true,
    });
    await asCaller(t.api, as("front_desk"), (tx) =>
      refused(tx, "SELECT * FROM app.staff_accounts()", [], "42501"),
    );
  });
});

describe("password sign-in", () => {
  it("first sign-in demands a new, strong password; then signs in as owner with a refresh token", async () => {
    expect(await login("duena.uno@ejemplo.com", "Password")).toMatchObject({
      ok: true,
      must_change: true,
    });
    expect(await change("duena.uno@ejemplo.com", "Password", "password123")).toMatchObject({
      ok: false,
      weak: true,
    });
    expect(await change("duena.uno@ejemplo.com", "Password", "duena.uno-2026!")).toMatchObject({
      ok: false,
      weak: true,
    }); // contains the e-mail name
    const ok = await change("duena.uno@ejemplo.com", "Password", "Gimnasio-Fuerte-2026");
    expect(ok).toMatchObject({
      ok: true,
      must_change: false,
      claims: { role: "owner", org_id: t.fx.A.orgId },
    });
    expect(ok.refresh).toMatch(/^[0-9a-f]{64}$/);
    expect((await login("duena.uno@ejemplo.com", "Password")).ok).toBe(false); // old password gone
    expect((await login("DUENA.UNO@ejemplo.com", "Gimnasio-Fuerte-2026")).ok).toBe(true);
  });

  it("unknown e-mail, wrong password and people without a password look the same", async () => {
    expect(await login("nadie@ejemplo.com", "Lo-que-sea-123")).toEqual({ ok: false });
    expect(await login("duena.uno@ejemplo.com", "incorrecta-123")).toEqual({ ok: false });
    const fixtureOwner = await t.admin.query<{ email: string }>(
      "SELECT p.email FROM app.person p WHERE p.id = $1",
      [t.fx.A.people.owner],
    );
    expect(await login(fixtureOwner.rows[0]?.email as string, "Password")).toEqual({ ok: false });
  });

  it("five wrong passwords lock the account for 15 minutes (even with the right one)", async () => {
    await create("bloqueo@ejemplo.com", "owner", null);
    await change("bloqueo@ejemplo.com", "Password", "Una-Clave-Larga-99");
    for (let i = 0; i < 5; i++) await login("bloqueo@ejemplo.com", `mala-${i}-xxxxxx`);
    expect(await login("bloqueo@ejemplo.com", "Una-Clave-Larga-99")).toEqual({
      ok: false,
      locked: true,
    });
  });

  it("location roles carry their location in the claims", async () => {
    await create("recepcion@ejemplo.com", "front_desk", t.fx.A.locations[1]);
    const r = await change("recepcion@ejemplo.com", "Password", "Mostrador-Seguro-7");
    expect(r.claims).toMatchObject({ role: "front_desk", location_ids: [t.fx.A.locations[1]] });
  });
});

describe("refresh tokens", () => {
  it("rotate on use; a reused token ends every session of that person; a removed role ends it too", async () => {
    const first = await login("duena.uno@ejemplo.com", "Gimnasio-Fuerte-2026");
    const use = async (tok: string) =>
      (await t.api.pool.query<{ r: R }>("SELECT app_public.session_refresh($1) AS r", [tok]))
        .rows[0]?.r as R;
    const second = await use(first.refresh as string);
    expect(second).toMatchObject({ ok: true, claims: { role: "owner" } });
    expect(second.refresh).not.toBe(first.refresh);
    expect((await use(first.refresh as string)).ok).toBe(false); // replayed → refused…
    expect((await use(second.refresh as string)).ok).toBe(false); // …and the whole family is revoked
    const third = await login("duena.uno@ejemplo.com", "Gimnasio-Fuerte-2026");
    await t.admin.query(
      "UPDATE app.staff_member SET active = false FROM app.person p WHERE p.id = staff_member.person_id AND p.email = 'duena.uno@ejemplo.com'",
    );
    expect((await use(third.refresh as string)).ok).toBe(false);
    expect((await use("zz")).ok).toBe(false);
  });

  it("request traffic cannot read credentials or tokens", async () => {
    await asCaller(t.api, as("owner"), async (tx) => {
      await refused(tx, "SELECT * FROM app_private.password_credential", [], "42501");
      await refused(tx, "SELECT * FROM app_private.refresh_token", [], "42501");
    });
  });
});

describe("owner chooses whether the next sign-in must change the password (0027)", () => {
  it("off → the initial password keeps working; a voluntary change still enforces the policy", async () => {
    const id = await create("sin.cambio@ejemplo.com", "owner", null);
    await asCaller(t.api, as("front_desk"), (tx) =>
      refused(tx, "SELECT app.set_password_change_required($1, false)", [id], "42501"),
    );
    await asCaller(t.api, as("owner"), (tx) =>
      tx.query("SELECT app.set_password_change_required($1, false)", [id]),
    );
    const a = await login("sin.cambio@ejemplo.com", "Password");
    expect(a).toMatchObject({ ok: true, must_change: false, claims: { role: "owner" } });
    expect((await login("sin.cambio@ejemplo.com", "Password")).ok).toBe(true); // still valid
    expect(await change("sin.cambio@ejemplo.com", "Password", "corta")).toMatchObject({
      ok: false,
      weak: true,
    });
    expect((await change("sin.cambio@ejemplo.com", "Password", "Mi-Clave-Elegida-2026")).ok).toBe(
      true,
    );
    expect((await login("sin.cambio@ejemplo.com", "Password")).ok).toBe(false);
  });

  it("another org's staff id is refused", async () => {
    const id = await create("otra.org@ejemplo.com", "owner", null);
    await asCaller(t.api, as("owner", t.fx.B), (tx) =>
      refused(tx, "SELECT app.set_password_change_required($1, false)", [id], "42501"),
    );
  });
});

describe("protected accounts and role switching (0028)", () => {
  let staffId = "";
  let person = "";
  beforeAll(async () => {
    staffId = (await create("protegida@ejemplo.com", "owner", null)) as string;
    const p = await t.admin.query<{ person_id: string }>(
      "SELECT person_id FROM app.staff_member WHERE id = $1",
      [staffId],
    );
    person = p.rows[0]?.person_id as string;
    await t.admin.query("INSERT INTO app_private.protected_person (person_id) VALUES ($1)", [
      person,
    ]);
    // Every staff role (location roles at the first location).
    for (const role of ["location_manager", "front_desk", "trainer"]) {
      const s = await t.admin.query<{ id: string }>(
        "INSERT INTO app.staff_member (org_id, person_id, role, display_name) VALUES ($1, $2, $3, 'Protegida') RETURNING id",
        [t.fx.A.orgId, person, role],
      );
      await t.admin.query(
        "INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES ($1, $2, $3)",
        [t.fx.A.orgId, s.rows[0]?.id, t.fx.A.locations[0]],
      );
    }
  });

  it("another owner cannot toggle its password requirement; the team list marks it protected", async () => {
    await asCaller(t.api, as("owner"), async (tx) => {
      await refused(
        tx,
        "SELECT app.set_password_change_required($1, false)",
        [staffId],
        "42501",
        "protected_account",
      );
      const r = await tx.query<{ protected: boolean }>(
        "SELECT protected FROM app.staff_accounts() WHERE staff_id = $1",
        [staffId],
      );
      expect(r.rows[0]?.protected).toBe(true);
    });
  });

  it("through the app nobody else can deactivate, re-role or delete it; the operator still can", async () => {
    const run = async (sql: string) => {
      await t.admin.query("BEGIN");
      try {
        await t.admin.query("SET LOCAL ROLE app_definer");
        await t.admin.query(sql, [person]);
        await t.admin.query("ROLLBACK");
        return "ok";
      } catch (e) {
        await t.admin.query("ROLLBACK");
        return (e as { message: string }).message;
      }
    };
    expect(await run("UPDATE app.staff_member SET active = false WHERE person_id = $1")).toBe(
      "protected_account",
    );
    expect(
      await run(
        "UPDATE app.staff_member SET role = 'chef' WHERE person_id = $1 AND role = 'trainer'",
      ),
    ).toBe("protected_account");
    // Deleting staff rows is not even granted to the app; the trigger is the second wall.
    expect(await run("DELETE FROM app.staff_member WHERE person_id = $1")).toMatch(
      /protected_account|permission denied/,
    );
    // Operator SQL (schema owner) is not blocked.
    await t.admin.query("BEGIN");
    await t.admin.query(
      "UPDATE app.staff_member SET display_name = 'Protegida' WHERE person_id = $1",
      [person],
    );
    await t.admin.query("ROLLBACK");
  });

  it("the protected person keeps its own password change and switches between its roles", async () => {
    const r = await change("protegida@ejemplo.com", "Password", "Clave-Propia-Segura-1");
    expect(r).toMatchObject({ ok: true, claims: { role: "owner" } });
    const claims = t.claims(t.fx.A, "owner", person);
    const roles = await asCaller(t.api, claims, async (tx) =>
      (await tx.query<{ role: string }>("SELECT role FROM app.my_roles()")).rows.map((x) => x.role),
    );
    expect(roles).toEqual(["owner", "location_manager", "front_desk", "trainer"]);
    const sw = await asCaller(
      t.api,
      claims,
      async (tx) =>
        (
          await tx.query<{
            r: { claims: { role: string; location_ids: string[] }; refresh: string };
          }>("SELECT app.switch_role('front_desk') AS r")
        ).rows[0]?.r,
    );
    expect(sw?.claims).toMatchObject({ role: "front_desk", location_ids: [t.fx.A.locations[0]] });
    expect(sw?.refresh).toMatch(/^[0-9a-f]{64}$/);
    await asCaller(t.api, claims, (tx) =>
      refused(tx, "SELECT app.switch_role('chef')", [], "42501"),
    );
  });
});

describe("PII guard switch (0028)", () => {
  it("on by default (demo rules); off accepts real e-mails and phones", async () => {
    const ok = async (sql: string, v: string) =>
      (await t.admin.query<{ ok: boolean }>(`SELECT ${sql}($1) AS ok`, [v])).rows[0]?.ok;
    expect(await ok("app.join_email_ok", "ana@gmail.com")).toBe(false);
    expect(await ok("app.join_email_ok", "ana@demo.invalid")).toBe(true);
    await t.admin.query(
      "INSERT INTO app_private.setting (key, value) VALUES ('pii_guard', 'false')",
    );
    try {
      expect(await ok("app.join_email_ok", "ana@gmail.com")).toBe(true);
      expect(await ok("app.join_email_ok", "no es correo")).toBe(false);
      expect(await ok("app.join_phone_ok", "+1-787-622-1234")).toBe(true);
      expect(await ok("app.join_phone_ok", "+1-787-555")).toBe(false);
    } finally {
      await t.admin.query("DELETE FROM app_private.setting WHERE key = 'pii_guard'");
    }
  });
});
