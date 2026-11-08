import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Equipment use (migration 0029): generated station codes, scans mapped to the routine, who sees the use.
let t: TestDb;
let member2A: string; // person id of A.members[1]
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
const run = <T>(
  org: OrgFixture,
  role: Role,
  fn: (tx: import("../src/index.js").Tx) => Promise<T>,
  personId?: string,
) => asCaller(t.api, as(org, role, personId), fn);
const scan = (org: OrgFixture, code: string, personId?: string) =>
  run(
    org,
    "member",
    async (tx) =>
      (await tx.query<{ id: string }>("SELECT app.start_equipment_use($1, 'scan') AS id", [code]))
        .rows[0]?.id as string,
    personId,
  );
const useRow = async (id: string) =>
  (await t.admin.query("SELECT * FROM app.equipment_use WHERE id = $1", [id])).rows[0];
const exerciseId = async (name: string, org: OrgFixture = t.fx.A) =>
  (
    await t.admin.query("SELECT id FROM app.exercise WHERE org_id = $1 AND name = $2", [
      org.orgId,
      name,
    ])
  ).rows[0].id as string;

describe("station codes are generated when left out", () => {
  it("numbers per equipment type across the whole org, ignoring codes in another format", async () => {
    const A = t.fx.A;
    const codes = await run(A, "owner", async (tx) => {
      const out: string[] = [];
      for (const type of ["barbell", "barbell", "bike"]) {
        const r = await tx.query<{ station_code: string }>(
          "INSERT INTO app.asset (location_id, equipment_type) VALUES ($1, $2) RETURNING station_code",
          [A.locations[0], type],
        );
        out.push(r.rows[0]?.station_code as string);
      }
      return out;
    });
    expect(codes).toEqual(["BAR-01", "BAR-02", "BIC-01"]);
  });

  it("a trainer scoped to one location never reuses a code taken at another location", async () => {
    const A = t.fx.A;
    await t.admin.query(
      "INSERT INTO app.asset (org_id, location_id, equipment_type, station_code) VALUES ($1, $2, 'bench', 'BAN-07')",
      [A.orgId, A.locations[1]],
    );
    const code = await run(A, "trainer", async (tx) => {
      const r = await tx.query<{ station_code: string }>(
        "INSERT INTO app.asset (location_id, equipment_type) VALUES ($1, 'bench') RETURNING station_code",
        [A.locations[0]],
      );
      return r.rows[0]?.station_code;
    });
    expect(code).toBe("BAN-08");
  });

  it("keeps a code the owner typed", async () => {
    const A = t.fx.A;
    const code = await run(A, "owner", async (tx) => {
      const r = await tx.query<{ station_code: string }>(
        "INSERT INTO app.asset (location_id, equipment_type, station_code) VALUES ($1, 'rack', 'RACK-SUR') RETURNING station_code",
        [A.locations[0]],
      );
      return r.rows[0]?.station_code;
    });
    expect(code).toBe("RACK-SUR");
  });

  it("codes are per org: org B starts its own numbering", async () => {
    const B = t.fx.B;
    const code = await run(B, "owner", async (tx) => {
      const r = await tx.query<{ station_code: string }>(
        "INSERT INTO app.asset (location_id, equipment_type) VALUES ($1, 'barbell') RETURNING station_code",
        [B.locations[0]],
      );
      return r.rows[0]?.station_code;
    });
    expect(code).toBe("BAR-01");
  });
});

describe("a member's scan registers the use and maps it to the routine", () => {
  it("without an open routine the use has no run or exercise", async () => {
    const id = await scan(t.fx.A, "A1-CP-01");
    const u = await useRow(id);
    expect(u.member_id).toBe(t.fx.A.members[0]);
    expect(u.circuit_run_id).toBeNull();
    expect(u.exercise_id).toBeNull();
    expect(u.ended_at).toBeNull();
  });

  it("with an open circuit run the scan maps to that circuit's step on this station", async () => {
    const A = t.fx.A;
    const circuit = (
      await t.admin.query(
        "SELECT id FROM app.circuit WHERE org_id = $1 AND name = 'Circuito Fuerza A'",
        [A.orgId],
      )
    ).rows[0].id;
    const runId = await run(A, "member", async (tx) => {
      const r = await tx.query<{ id: string }>("SELECT app.start_circuit_run($1) AS id", [circuit]);
      return r.rows[0]?.id as string;
    });
    const lat = await scan(A, "A1-LAT-01");
    const u = await useRow(lat);
    expect(u.circuit_run_id).toBe(runId);
    expect(u.exercise_id).toBe(await exerciseId("Jalón al pecho"));
    // The step that names an equipment type (not a station) maps too.
    const cp = await scan(A, "A1-CP-01");
    expect((await useRow(cp)).exercise_id).toBe(await exerciseId("Press de pecho en máquina"));
    // The previous use was closed by the new scan; only one stays open.
    expect((await useRow(lat)).ended_at).not.toBeNull();
    const open = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.equipment_use WHERE member_id = $1 AND ended_at IS NULL",
      [A.members[0]],
    );
    expect(open.rows[0].n).toBe(1);
  });

  it("scanning the same station again keeps the same use", async () => {
    const a = await scan(t.fx.A, "A1-BAR-01");
    const b = await scan(t.fx.A, "a1-bar-01 ");
    expect(b).toBe(a);
  });

  it("a set logged on the station keeps the use alive", async () => {
    const A = t.fx.A;
    const id = await scan(A, "A1-BAR-01");
    await t.admin.query(
      "UPDATE app.equipment_use SET started_at = now() - interval '30 minutes', last_activity_at = now() - interval '30 minutes' WHERE id = $1",
      [id],
    );
    const asset = (
      await t.admin.query(
        "SELECT id FROM app.asset WHERE org_id = $1 AND station_code = 'A1-BAR-01'",
        [A.orgId],
      )
    ).rows[0].id;
    const squat = await exerciseId("Sentadilla con barra");
    await run(A, "member", (tx) =>
      tx.query("SELECT app.log_set($1, $2, $3, NULL, 8, 60)", [squat, A.locations[0], asset]),
    );
    const u = await useRow(id);
    expect(new Date(u.last_activity_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("a stale open use is closed at its last activity on the next scan", async () => {
    const A = t.fx.A;
    const id = await scan(A, "A1-BAR-01");
    await t.admin.query(
      "UPDATE app.equipment_use SET started_at = now() - interval '2 hours', last_activity_at = now() - interval '90 minutes' WHERE id = $1",
      [id],
    );
    await scan(A, "A1-LAT-01");
    const u = await useRow(id);
    expect(new Date(u.ended_at).getTime()).toBe(new Date(u.last_activity_at).getTime());
  });

  it("the member ends their own use; nobody else can", async () => {
    const A = t.fx.A;
    const id = await scan(A, "A1-BAR-01");
    await expect(
      run(A, "member", (tx) => tx.query("SELECT app.end_equipment_use($1)", [id]), member2A),
    ).rejects.toThrow(/forbidden/);
    await run(A, "member", (tx) => tx.query("SELECT app.end_equipment_use($1)", [id]));
    expect((await useRow(id)).ended_at).not.toBeNull();
  });
});

describe("refusals", () => {
  it("equipment out of service or in maintenance cannot be used", async () => {
    await expect(scan(t.fx.A, "A1-LP-02")).rejects.toThrow(/asset_unavailable/);
    await expect(scan(t.fx.A, "A1-TM-01")).rejects.toThrow(/asset_unavailable/);
  });

  it("unknown codes and codes of another org are not found", async () => {
    await expect(scan(t.fx.A, "NO-EXISTE-01")).rejects.toThrow(/not_found/);
    await expect(scan(t.fx.A, "B1-BAR-01")).rejects.toThrow(/not_found/);
  });

  it("staff cannot register a use (it is the member's own log)", async () => {
    for (const role of ["owner", "trainer", "front_desk"] as Role[]) {
      await expect(
        run(t.fx.A, role, (tx) => tx.query("SELECT app.start_equipment_use('A1-BAR-01', 'scan')")),
        role,
      ).rejects.toThrow(/forbidden/);
    }
  });

  it("no direct writes", async () => {
    await expect(
      run(t.fx.A, "member", (tx) =>
        tx.query("UPDATE app.equipment_use SET ended_at = now() WHERE member_id = $1", [
          t.fx.A.members[0],
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("who sees equipment use", () => {
  const seen = (org: OrgFixture, role: Role, personId?: string) =>
    run(
      org,
      role,
      async (tx) =>
        (
          await tx.query<{ location_id: string; member_id: string }>(
            "SELECT location_id, member_id FROM app.equipment_use",
          )
        ).rows,
      personId,
    );

  it("owner sees every location; trainer and location manager only theirs", async () => {
    const A = t.fx.A;
    const owner = await seen(A, "owner");
    expect(new Set(owner.map((r) => r.location_id))).toEqual(new Set(A.locations));
    for (const role of ["trainer", "location_manager"] as Role[]) {
      const rows = await seen(A, role);
      expect(rows.length, role).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.location_id)), role).toEqual(new Set([A.locations[0]]));
    }
  });

  it("front desk, accountant and clinical roles see nothing", async () => {
    for (const role of [
      "front_desk",
      "accountant",
      "clinician",
      "chef",
      "nutritionist",
    ] as Role[]) {
      expect(await seen(t.fx.A, role), role).toHaveLength(0);
    }
  });

  it("a member sees only their own uses, and nothing crosses orgs", async () => {
    const mine = await seen(t.fx.A, "member", member2A);
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((r) => r.member_id))).toEqual(new Set([t.fx.A.members[1]]));
    const b = await seen(t.fx.B, "owner");
    expect(b.every((r) => t.fx.B.locations.includes(r.location_id))).toBe(true);
  });
});
