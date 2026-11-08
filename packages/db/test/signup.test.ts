import type { Role } from "@gym/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
const V = "v2026-11";
const as = (role: Role, org: OrgFixture = t.fx.A, person?: string) => t.claims(org, role, person);

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

let seq = 0;
const email = (tag = "nuevo") => {
  seq += 1;
  return `${tag}${seq}.${Date.now()}@demo.invalid`;
};

/** Birth date that makes someone exactly `years` old today in Puerto Rico (plus `days` later = younger). */
async function birth(years: number, days = 0): Promise<string> {
  const r = await t.admin.query<{ d: string }>(
    "SELECT to_char(((now() AT TIME ZONE 'America/Puerto_Rico')::date - make_interval(years => $1))::date + $2::int, 'YYYY-MM-DD') AS d",
    [years, days],
  );
  return r.rows[0]?.d as string;
}

interface Join {
  org: string;
  location: string;
  full_name: string;
  email: string;
  phone: string | null;
  birth_date: string;
  terms_version: string;
  waiver_version: string;
  accept_terms: boolean;
  accept_waiver: boolean;
  sms_reminders: boolean;
  sms_marketing: boolean;
  locale: string;
}
async function valid(over: Partial<Join> = {}): Promise<Join> {
  return {
    org: t.fx.A.orgId,
    location: t.fx.A.locations[0],
    full_name: "Lucía Torres Demo",
    email: email(),
    phone: "+1-787-555-0142",
    birth_date: await birth(30),
    terms_version: V,
    waiver_version: V,
    accept_terms: true,
    accept_waiver: true,
    sms_reminders: false,
    sms_marketing: false,
    locale: "es",
    ...over,
  };
}

const SUBMIT =
  "SELECT app_public.join_submit($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13) AS r";
const args = (j: Join) => [
  j.org,
  j.location,
  j.full_name,
  j.email,
  j.phone,
  j.birth_date,
  j.terms_version,
  j.waiver_version,
  j.accept_terms,
  j.accept_waiver,
  j.sms_reminders,
  j.sms_marketing,
  j.locale,
];

/** Call as the API login role with NO claims (exactly what the public route does). */
async function submit(j: Join, client?: pg.ClientBase) {
  const { rows } = await (client ?? t.api.pool).query<{ r: Record<string, string> }>(
    SUBMIT,
    args(j),
  );
  return rows[0]?.r as Record<string, string>;
}
async function refused(j: Join, code: string) {
  await expect(submit(j)).rejects.toThrow(code);
  const p = await t.admin.query("SELECT 1 FROM app.person WHERE lower(email) = lower($1)", [
    j.email.trim(),
  ]);
  expect(p.rowCount, `nothing stored for ${j.email}`).toBe(0);
}
async function info(org: string) {
  const { rows } = await t.api.pool.query<{ r: Record<string, unknown> | null }>(
    "SELECT app_public.join_info($1) AS r",
    [org],
  );
  return rows[0]?.r ?? null;
}

let orgSeq = 0;
/** A fresh organisation with one open location (and optionally a closed one) so cap tests own their window. */
async function newOrg(opts: { dropInCents?: number; monthly?: boolean } = {}) {
  orgSeq += 1;
  const q = async (sql: string, p: unknown[]) =>
    (await t.admin.query<{ id: string }>(sql, p)).rows[0]?.id as string;
  const org = await q("INSERT INTO app.organization (name) VALUES ($1) RETURNING id", [
    `Demo Join ${orgSeq}`,
  ]);
  const le = await q(
    "INSERT INTO app.legal_entity (org_id, legal_name) VALUES ($1, 'Demo LLC') RETURNING id",
    [org],
  );
  const brand = await q(
    `INSERT INTO app.brand (org_id, legal_entity_id, name, theme) VALUES ($1, $2, 'Demo Join', $3) RETURNING id`,
    [
      org,
      le,
      JSON.stringify({
        logo_url: "/brand/demo-logo.png",
        logo_alt: "<img src=x onerror=alert(1)>",
        colors: { accent: "#6D6128", accent_text: "#FFFFFF", evil: "#000000" },
        tagline_es: "Solo pagas tu sesión",
      }),
    ],
  );
  const loc = await q(
    "INSERT INTO app.location (org_id, brand_id, legal_entity_id, name, municipality) VALUES ($1,$2,$3,'Demo Sede Join','Caguas') RETURNING id",
    [org, brand, le],
  );
  await t.admin.query(
    "INSERT INTO app.join_location (org_id, location_id, enabled, updated_by) VALUES ($1, $2, true, $3)",
    [org, loc, t.fx.A.people.owner],
  );
  if (opts.dropInCents !== undefined) {
    const prod = await q(
      "INSERT INTO app.plan_product (org_id, kind, name) VALUES ($1, 'drop_in', 'Sesion') RETURNING id",
      [org],
    );
    await t.admin.query(
      "INSERT INTO app.price (org_id, product_id, amount_cents) VALUES ($1, $2, $3)",
      [org, prod, opts.dropInCents],
    );
  }
  if (opts.monthly) {
    const prod = await q(
      "INSERT INTO app.plan_product (org_id, kind, name) VALUES ($1, 'membership', 'Mensual') RETURNING id",
      [org],
    );
    await t.admin.query(
      "INSERT INTO app.price (org_id, product_id, amount_cents, billing_interval) VALUES ($1, $2, 3000, 'month')",
      [org, prod],
    );
  }
  return { org, loc, brand };
}

describe("public join info", () => {
  it("lists only open locations of the org with a sanitised theme and the current texts", async () => {
    const r = (await info(t.fx.A.orgId)) as {
      locations: Array<{ id: string; name: string; municipality: string }>;
      agreements: Array<{ kind: string; version: string; locale: string; body: string }>;
      brand: { name: string };
    };
    expect(r.locations.map((l) => l.id)).toEqual([t.fx.A.locations[0]]);
    expect(r.locations[0]?.municipality).toBe("San Juan");
    expect(r.brand.name).toBe("Demo A Fitness");
    const kinds = new Set(r.agreements.map((a) => `${a.kind}:${a.locale}:${a.version}`));
    for (const k of ["terms", "waiver", "sms_reminder", "sms_marketing"])
      for (const l of ["es", "en"]) expect(kinds.has(`${k}:${l}:${V}`)).toBe(true);
    // The brand name is filled in server-side; no placeholder survives.
    expect(r.agreements.some((a) => a.body.includes("{brand}"))).toBe(false);
    expect(r.agreements.find((a) => a.kind === "sms_marketing")?.body).toContain("STOP");
  });

  it("drops unknown theme keys and unsafe alt text; derives the pay-per-session model from billing", async () => {
    const o = await newOrg({ dropInCents: 1500 });
    const r = (await info(o.org)) as {
      brand: { theme: Record<string, unknown> };
      model: { pay_per_session: boolean; session_from_cents: number };
    };
    expect(r.brand.theme).toEqual({
      logo_url: "/brand/demo-logo.png",
      tagline_es: "Solo pagas tu sesión",
      colors: { accent: "#6D6128", accent_text: "#FFFFFF" },
    });
    expect(r.model).toEqual({ pay_per_session: true, session_from_cents: 1500 });
    const m = await newOrg({ dropInCents: 1500, monthly: true });
    expect(
      ((await info(m.org)) as { model: { pay_per_session: boolean } }).model.pay_per_session,
    ).toBe(false);
  });

  it("passes the brand's colour mode and dark accent pair to the public page", async () => {
    const o = await newOrg({ dropInCents: 1500 });
    await t.admin.query(
      `UPDATE app.brand SET theme = theme || '{"mode":"dark"}'::jsonb
         || jsonb_build_object('colors', theme -> 'colors' || '{"accent_dark":"#C3B444","accent_dark_text":"#111111"}'::jsonb)
        WHERE org_id = $1`,
      [o.org],
    );
    const r = (await info(o.org)) as { brand: { theme: Record<string, unknown> } };
    expect(r.brand.theme.mode).toBe("dark");
    expect(r.brand.theme.colors).toMatchObject({
      accent_dark: "#C3B444",
      accent_dark_text: "#111111",
    });
  });

  it("passes the brand's own hero photo and drops unsafe ones (0022)", async () => {
    const o = await newOrg({ dropInCents: 1500 });
    await t.admin.query(
      `UPDATE app.brand SET theme = theme || '{"hero_url":"/brand/demo-hero.jpg"}'::jsonb WHERE org_id = $1`,
      [o.org],
    );
    const r = (await info(o.org)) as { brand: { theme: Record<string, unknown> } };
    expect(r.brand.theme.hero_url).toBe("/brand/demo-hero.jpg");
  });

  it("returns null for an unknown org and for an org without open locations", async () => {
    expect(await info("00000000-0000-4000-8000-000000000999")).toBeNull();
    const o = await newOrg();
    await t.admin.query("UPDATE app.join_location SET enabled = false WHERE location_id = $1", [
      o.loc,
    ]);
    expect(await info(o.org)).toBeNull();
  });
});

describe("public join submit: happy path", () => {
  it("creates person, lead member, agreements, only the consents ticked, an attempt and an audit row", async () => {
    const j = await valid({ sms_reminders: true, full_name: "  María  José Ñeco-O'Neill " });
    const r = await submit(j);
    expect(r.outcome).toBe("created");
    expect(r.full_name).toBe("María José Ñeco-O'Neill");
    const m = await t.admin.query(
      "SELECT m.org_id, m.home_location_id, m.status, m.phone, p.email FROM app.member m JOIN app.person p ON p.id = m.person_id WHERE m.id = $1",
      [r.member_id],
    );
    expect(m.rows[0]).toEqual({
      org_id: t.fx.A.orgId,
      home_location_id: t.fx.A.locations[0],
      status: "lead",
      phone: "+1-787-555-0142",
      email: j.email,
    });
    const ag = await t.admin.query(
      "SELECT kind, version, source, accepted_by FROM app.member_agreement WHERE member_id = $1 ORDER BY kind",
      [r.member_id],
    );
    expect(ag.rows).toEqual([
      { kind: "terms", version: V, source: "member_portal", accepted_by: r.person_id },
      { kind: "waiver", version: V, source: "member_portal", accepted_by: r.person_id },
    ]);
    const c = await t.admin.query(
      "SELECT channel, purpose, status, source, brand_id, recorded_by, evidence FROM app.consent WHERE member_id = $1",
      [r.member_id],
    );
    expect(c.rows).toHaveLength(1); // marketing was NOT ticked → no row at all
    expect(c.rows[0]).toMatchObject({
      channel: "sms",
      purpose: "reminder",
      status: "granted",
      source: "member_portal",
      brand_id: t.fx.A.brandId,
      recorded_by: r.person_id,
    });
    expect(c.rows[0].evidence).toContain(`sms_reminder ${V}`);
    const ev = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.consent_event WHERE member_id = $1",
      [r.member_id],
    );
    expect(ev.rows[0].n).toBe(1);
    const at = await t.admin.query(
      "SELECT outcome, location_id FROM app.join_attempt WHERE member_id = $1",
      [r.member_id],
    );
    expect(at.rows).toEqual([{ outcome: "created", location_id: t.fx.A.locations[0] }]);
    const au = await t.admin.query(
      "SELECT actor_person_id, actor_role, action, location_id, meta FROM app.audit_log WHERE entity_id = $1",
      [r.member_id],
    );
    expect(au.rows).toHaveLength(1);
    expect(au.rows[0]).toMatchObject({
      actor_person_id: r.person_id,
      actor_role: "member",
      action: "member.join_online",
      location_id: t.fx.A.locations[0],
    });
    expect(au.rows[0].meta).toMatchObject({
      status: "lead",
      sms_reminder: true,
      sms_marketing: false,
    });
  });

  it("phone is optional; both SMS boxes create both consents; e-mail is stored lower-case", async () => {
    const none = await submit(await valid({ phone: null }));
    expect(none.outcome).toBe("created");
    const e = email("MAYUS").toUpperCase().replace("@DEMO.INVALID", "@Demo.Invalid");
    const both = await submit(await valid({ email: e, sms_reminders: true, sms_marketing: true }));
    const c = await t.admin.query(
      "SELECT purpose FROM app.consent WHERE member_id = $1 ORDER BY purpose",
      [both.member_id],
    );
    expect(c.rows.map((x) => x.purpose)).toEqual(["reminder", "marketing"]);
    const p = await t.admin.query("SELECT email FROM app.person WHERE id = $1", [both.person_id]);
    expect(p.rows[0].email).toBe(e.toLowerCase());
  });

  it("someone exactly 21 today may join; 939 numbers are accepted", async () => {
    const r = await submit(await valid({ birth_date: await birth(21), phone: "+1-939-555-0199" }));
    expect(r.outcome).toBe("created");
  });

  it("the new member reads their own agreements; staff of the home location read them; others do not", async () => {
    const r = await submit(await valid());
    const read = (role: Role, org: OrgFixture = t.fx.A, person?: string) =>
      asCaller(
        t.api,
        as(role, org, person),
        async (tx) =>
          (
            await tx.query("SELECT kind FROM app.member_agreement WHERE member_id = $1", [
              r.member_id,
            ])
          ).rowCount,
      );
    expect(await read("member", t.fx.A, r.person_id)).toBe(2);
    for (const role of [
      "owner",
      "location_manager",
      "front_desk",
      "trainer",
      "accountant",
    ] as Role[])
      expect(await read(role), role).toBe(2);
    expect(await read("member")).toBe(0); // another member
    expect(await read("guardian")).toBe(0); // not their ward
    expect(await read("owner", t.fx.B)).toBe(0); // other org
    // Staff of the other location (front desk assigned to locations[1] only).
    const other = { ...as("front_desk"), location_ids: [t.fx.A.locations[1]] };
    expect(
      await asCaller(
        t.api,
        other,
        async (tx) =>
          (await tx.query("SELECT 1 FROM app.member_agreement WHERE member_id = $1", [r.member_id]))
            .rowCount,
      ),
    ).toBe(0);
  });
});

describe("public join submit: refusals store nothing", () => {
  it("refuses any e-mail outside @demo.invalid (PII guard)", async () => {
    for (const e of [
      "ana@gmail.com",
      "ana@demo.invalid.com",
      "ana@demo-invalid",
      "ana@sub.demo.invalid",
      "@demo.invalid",
      "ana@demo.invalid\n",
      "ana'--@demo.invalid",
      "ana<x>@demo.invalid",
      `${"a".repeat(70)}@demo.invalid`,
    ])
      await refused(await valid({ email: e }), "invalid_email");
  });

  it("refuses any phone outside the fictional 555-01xx range in 787/939", async () => {
    for (const p of [
      "+1-787-555-0200",
      "+1-212-555-0101",
      "+1-787-555-1234",
      "787-555-0101",
      "+17875550101",
      "+1-787-555-010",
      "+1-787-555-0101\n",
    ])
      await refused(await valid({ phone: p }), "invalid_phone");
  });

  it("refuses under 21 (one day short), under 13, future and absurd birth dates", async () => {
    await refused(await valid({ birth_date: await birth(21, 1) }), "age_requires_guardian");
    await refused(await valid({ birth_date: await birth(17) }), "age_requires_guardian");
    await refused(await valid({ birth_date: await birth(12) }), "age_requires_guardian");
    await refused(await valid({ birth_date: await birth(0, 5) }), "invalid_birth_date");
    await refused(await valid({ birth_date: "1899-12-31" }), "invalid_birth_date");
  });

  it("an under-13 visitor leaves no trace at all (no person, member, attempt or audit row)", async () => {
    const counts = async () =>
      (
        await t.admin.query(
          `SELECT (SELECT count(*) FROM app.person)::int AS p, (SELECT count(*) FROM app.member)::int AS m,
                  (SELECT count(*) FROM app.join_attempt)::int AS a, (SELECT count(*) FROM app.audit_log)::int AS l`,
        )
      ).rows[0];
    const before = await counts();
    await refused(await valid({ birth_date: await birth(10) }), "age_requires_guardian");
    expect(await counts()).toEqual(before);
  });

  it("refuses a location of another org, a closed location and an unknown org", async () => {
    await refused(await valid({ location: t.fx.B.locations[0] }), "invalid_location");
    await refused(await valid({ location: t.fx.A.locations[1] }), "invalid_location");
    await refused(await valid({ org: "00000000-0000-4000-8000-000000000999" }), "org_not_found");
  });

  it("refuses missing agreements, an outdated version, SMS without a phone and an unknown locale", async () => {
    await refused(await valid({ accept_terms: false }), "agreements_required");
    await refused(await valid({ accept_waiver: false }), "agreements_required");
    await refused(await valid({ terms_version: "v2025-01" }), "agreement_outdated");
    await refused(await valid({ waiver_version: "v2025-01" }), "agreement_outdated");
    await refused(await valid({ phone: null, sms_reminders: true }), "phone_required_for_sms");
    await refused(await valid({ phone: null, sms_marketing: true }), "phone_required_for_sms");
    await refused(await valid({ locale: "fr" }), "invalid_locale");
  });

  it("refuses hostile names (markup, placeholders, links, digits, newlines, other scripts)", async () => {
    for (const n of [
      "<script>alert(1)</script>",
      "{{brand}} Demo",
      "Ana\nRivera",
      "Аna Rivera", // Cyrillic А
      "Robert'); DROP TABLE app.member;--",
      "www.evil.com",
      "Ana 787 555 0101",
      "A",
      "x".repeat(121),
      "Ana  Rivera\t",
    ])
      await refused(await valid({ full_name: n }), "invalid_name");
  });
});

describe("identity: existing e-mails get a generic answer and nothing else", () => {
  it("an e-mail that exists in ANOTHER org creates and attaches nothing", async () => {
    const before = await t.admin.query(
      "SELECT (SELECT count(*) FROM app.member WHERE org_id = $1)::int AS m, (SELECT count(*) FROM app.person)::int AS p",
      [t.fx.A.orgId],
    );
    const r = await submit(await valid({ email: "member.b@demo.invalid" }));
    expect(r).toEqual({ outcome: "existing" });
    const after = await t.admin.query(
      "SELECT (SELECT count(*) FROM app.member WHERE org_id = $1)::int AS m, (SELECT count(*) FROM app.person)::int AS p",
      [t.fx.A.orgId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const shared = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.member m JOIN app.person p ON p.id = m.person_id WHERE p.email = 'member.b@demo.invalid'",
    );
    expect(shared.rows[0].n).toBe(1); // still only the org B membership
  });

  it("the same answer for an e-mail already in THIS org (case-insensitive), and an 'existing' attempt is logged", async () => {
    const before = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.join_attempt WHERE org_id = $1 AND outcome = 'existing'",
      [t.fx.A.orgId],
    );
    expect(await submit(await valid({ email: "Member.A@demo.invalid" }))).toEqual({
      outcome: "existing",
    });
    const j = await valid();
    expect((await submit(j)).outcome).toBe("created");
    expect(await submit({ ...j, full_name: "Otra Persona Demo" })).toEqual({ outcome: "existing" });
    const after = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.join_attempt WHERE org_id = $1 AND outcome = 'existing'",
      [t.fx.A.orgId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 2);
    const names = await t.admin.query(
      "SELECT m.full_name FROM app.member m JOIN app.person p ON p.id = m.person_id WHERE p.email = $1",
      [j.email],
    );
    expect(names.rows).toEqual([{ full_name: "Lucía Torres Demo" }]); // never overwritten
  });

  it("two orgs racing on the same new e-mail: one is created, the other gets the generic answer", async () => {
    const o1 = await newOrg();
    const o2 = await newOrg();
    const e = email("race");
    const c1 = new pg.Client({ connectionString: t.apiUrl });
    const c2 = new pg.Client({ connectionString: t.apiUrl });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query("BEGIN");
      const first = await submit(await valid({ org: o1.org, location: o1.loc, email: e }), c1);
      expect(first.outcome).toBe("created");
      const second = submit(await valid({ org: o2.org, location: o2.loc, email: e }), c2);
      await new Promise((r) => setTimeout(r, 200)); // c2 now waits on the unique e-mail index
      await c1.query("COMMIT");
      expect(await second).toEqual({ outcome: "existing" });
    } finally {
      await c1.end();
      await c2.end();
    }
  });
});

describe("abuse: per-org cap of 30 attempts per hour", () => {
  it("refuses the 31st attempt in an hour (created and existing both count); older attempts do not", async () => {
    const o = await newOrg();
    await t.admin.query(
      `INSERT INTO app.join_attempt (org_id, location_id, outcome, at)
       SELECT $1, $2, 'existing', now() - interval '2 hours' FROM generate_series(1, 40)`,
      [o.org, o.loc],
    );
    await t.admin.query(
      `INSERT INTO app.join_attempt (org_id, location_id, outcome, at)
       SELECT $1, $2, 'existing', now() - interval '10 minutes' FROM generate_series(1, 28)`,
      [o.org, o.loc],
    );
    expect((await submit(await valid({ org: o.org, location: o.loc }))).outcome).toBe("created");
    expect(
      await submit(await valid({ org: o.org, location: o.loc, email: "member.a@demo.invalid" })),
    ).toEqual({ outcome: "existing" });
    await refused(await valid({ org: o.org, location: o.loc }), "rate_limited");
    // Another org is unaffected.
    expect((await submit(await valid())).outcome).toBe("created");
  });

  it("two concurrent attempts at 29/30 cannot both pass (advisory lock)", async () => {
    const o = await newOrg();
    await t.admin.query(
      `INSERT INTO app.join_attempt (org_id, location_id, outcome, at)
       SELECT $1, $2, 'existing', now() - interval '1 minute' FROM generate_series(1, 29)`,
      [o.org, o.loc],
    );
    const c1 = new pg.Client({ connectionString: t.apiUrl });
    const c2 = new pg.Client({ connectionString: t.apiUrl });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query("BEGIN");
      expect((await submit(await valid({ org: o.org, location: o.loc }), c1)).outcome).toBe(
        "created",
      );
      // Settle the second attempt into a value right away: its error can arrive in the same tick as COMMIT's
      // reply, before a later `expect(...).rejects` would attach (seen as an unhandled rejection in the gate).
      const second = submit(await valid({ org: o.org, location: o.loc }), c2).then(
        (r) => ({ ok: true as const, r }),
        (e: Error) => ({ ok: false as const, e }),
      );
      await new Promise((r) => setTimeout(r, 200));
      await c1.query("COMMIT");
      const res = await second;
      expect(res.ok).toBe(false);
      expect(res.ok ? "" : res.e.message).toContain("rate_limited");
    } finally {
      await c1.end();
      await c2.end();
    }
  });
});

describe("privileges", () => {
  const SIG =
    "app_public.join_submit(uuid, uuid, text, text, text, date, text, text, boolean, boolean, boolean, boolean, text)";

  it("PUBLIC and app_authenticated cannot use the public functions; app_api can", async () => {
    const r = await t.admin.query(
      `SELECT has_function_privilege('public', '${SIG}', 'EXECUTE') AS pub_submit,
              has_function_privilege('public', 'app_public.join_info(uuid)', 'EXECUTE') AS pub_info,
              has_function_privilege('app_authenticated', '${SIG}', 'EXECUTE') AS auth_submit,
              has_function_privilege('app_authenticated', 'app_public.join_info(uuid)', 'EXECUTE') AS auth_info,
              has_schema_privilege('app_authenticated', 'app_public', 'USAGE') AS auth_schema,
              has_function_privilege('app_api', '${SIG}', 'EXECUTE') AS api_submit,
              (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = '${SIG}'::regprocedure) AS owner,
              (SELECT prosecdef FROM pg_proc WHERE oid = '${SIG}'::regprocedure) AS definer`,
    );
    expect(r.rows[0]).toEqual({
      pub_submit: false,
      pub_info: false,
      auth_submit: false,
      auth_info: false,
      auth_schema: false,
      api_submit: true,
      owner: "app_definer",
      definer: true,
    });
  });

  it("a signed-in caller (request traffic) cannot call the public sign-up", async () => {
    const j = await valid();
    await expect(
      asCaller(t.api, as("owner"), (tx) => tx.query(SUBMIT, args(j))),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("the API login role still cannot read any table directly", async () => {
    await expect(t.api.pool.query("SELECT * FROM app.member_agreement")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(t.api.pool.query("SELECT * FROM app.person")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("request traffic cannot write the signup tables directly", async () => {
    const m = t.fx.A.members[0];
    for (const [sql, p] of [
      [
        "INSERT INTO app.member_agreement (member_id, kind, version, locale, source, accepted_by) VALUES ($1,'terms','v2026-11','es','front_desk',$2)",
        [m, t.fx.A.people.owner],
      ],
      ["UPDATE app.member_agreement SET version = 'v2026-12' WHERE member_id = $1", [m]],
      ["DELETE FROM app.member_agreement WHERE member_id = $1", [m]],
      [
        "INSERT INTO app.join_attempt (location_id, outcome) VALUES ($1, 'existing')",
        [t.fx.A.locations[0]],
      ],
      ["DELETE FROM app.join_attempt WHERE location_id = $1", [t.fx.A.locations[0]]],
      ["UPDATE app.join_location SET enabled = true WHERE location_id = $1", [t.fx.A.locations[1]]],
      ["UPDATE app.agreement_text SET is_current = false WHERE kind = $1", ["terms"]],
    ] as Array<[string, unknown[]]>) {
      await expect(
        asCaller(t.api, as("owner"), (tx) => tx.query(sql, p)),
        sql,
      ).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});

describe("staff switch per location", () => {
  const setJoin = (claims: ReturnType<typeof as>, loc: string, enabled: boolean) =>
    asCaller(t.api, claims, (tx) =>
      tx.query("SELECT app.set_join_location($1, $2)", [loc, enabled]),
    );

  it("the owner and the manager of the location switch it; the change is audited", async () => {
    await setJoin(as("owner"), t.fx.A.locations[1], true);
    expect(((await info(t.fx.A.orgId)) as { locations: unknown[] }).locations).toHaveLength(2);
    await setJoin(as("location_manager"), t.fx.A.locations[0], true);
    await setJoin(as("owner"), t.fx.A.locations[1], false);
    const a = await t.admin.query(
      "SELECT actor_role, meta FROM app.audit_log WHERE action = 'join_location.set' AND org_id = $1 ORDER BY at, id",
      [t.fx.A.orgId],
    );
    expect(a.rows.map((x) => [x.actor_role, x.meta.enabled])).toEqual([
      ["owner", true],
      ["location_manager", true],
      ["owner", false],
    ]);
  });

  it("refuses other roles, a manager of another location and a location of another org", async () => {
    for (const role of ["front_desk", "trainer", "accountant", "member", "chef"] as Role[])
      await expect(setJoin(as(role), t.fx.A.locations[0], false), role).rejects.toMatchObject({
        code: "42501",
      });
    await expect(setJoin(as("location_manager"), t.fx.A.locations[1], true)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(setJoin(as("owner"), t.fx.B.locations[0], false)).rejects.toMatchObject({
      code: "42501",
    });
    const b = await t.admin.query("SELECT enabled FROM app.join_location WHERE location_id = $1", [
      t.fx.B.locations[0],
    ]);
    expect(b.rows[0].enabled).toBe(true);
  });

  it("join_location is visible to staff of the location only; join_attempt to owner and that manager", async () => {
    const count = (role: Role, table: string, org: OrgFixture = t.fx.A) =>
      asCaller(t.api, as(role, org), async (tx) =>
        Number((await tx.query(`SELECT count(*)::int AS n FROM app.${table}`)).rows[0].n),
      );
    expect(await count("owner", "join_location")).toBe(2);
    expect(await count("front_desk", "join_location")).toBe(1);
    expect(await count("member", "join_location")).toBe(0);
    expect(await count("owner", "join_attempt")).toBeGreaterThan(0);
    expect(await count("location_manager", "join_attempt")).toBeGreaterThan(0);
    for (const role of ["front_desk", "trainer", "accountant", "member", "guardian"] as Role[])
      expect(await count(role, "join_attempt"), role).toBe(0);
    const b = await asCaller(
      t.api,
      as("owner", t.fx.B),
      async (tx) =>
        (await tx.query("SELECT 1 FROM app.join_attempt WHERE org_id = $1", [t.fx.A.orgId]))
          .rowCount,
    );
    expect(b).toBe(0);
  });
});
