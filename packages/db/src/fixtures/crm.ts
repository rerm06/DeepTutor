import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module crm (rows in every table, both orgs). Inserted by the admin connection without claims,
 * so the crm triggers skip validation and auditing (system path).
 *
 * Funnel cohort (created June 2025, untouched by other tests) — crm.test.ts asserts these exact numbers:
 *   locations[0] · web:      new, contacted, won (→ members[0])  → total 3, won 1, 33.3 %
 *   locations[0] · referral: trial, lost                         → total 2, won 0, 0.0 %
 *   locations[1] · walk_in:  tour_booked                         → total 1, won 0, 0.0 %
 * Working leads (created now, names "Demo Lead <label> …") are what the behaviour tests act on.
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const staff = async (role: string): Promise<string> => {
    const { rows } = await c.query<{ id: string }>(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = $3",
      [org.orgId, org.people[role as keyof typeof org.people], role],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`crm fixture: no staff ${role}`);
    return id;
  };
  const frontDesk = await staff("front_desk");
  const trainer = await staff("trainer");
  const owner = await staff("owner");
  const [loc0, loc1] = org.locations;

  const lead = async (
    loc: string,
    source: string,
    stage: string,
    name: string,
    opts: { createdAt?: string; member?: string; lost?: string; ownerStaff?: string } = {},
  ): Promise<string> => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.lead (org_id, location_id, source, stage, lost_reason, owner_staff_id, full_name, email, phone,
                             member_id, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'+1 787 555 0199',$9,$10, coalesce($11::timestamptz, now())) RETURNING id`,
      [
        org.orgId,
        loc,
        source,
        stage,
        opts.lost ?? null,
        opts.ownerStaff ?? null,
        name,
        `${name.toLowerCase().replaceAll(" ", ".")}@demo.invalid`,
        opts.member ?? null,
        org.people.front_desk,
        opts.createdAt ?? null,
      ],
    );
    return rows[0]?.id as string;
  };

  // Funnel cohort (June 2025, local time well inside the day).
  const june = (d: number) => `2025-06-${String(d).padStart(2, "0")} 15:00:00+00`;
  await lead(loc0, "web", "new", `Demo Funnel ${label} Web Uno`, { createdAt: june(2) });
  await lead(loc0, "web", "contacted", `Demo Funnel ${label} Web Dos`, { createdAt: june(3) });
  await lead(loc0, "web", "won", `Demo Funnel ${label} Web Tres`, {
    createdAt: june(4),
    member: org.members[0],
  });
  await lead(loc0, "referral", "trial", `Demo Funnel ${label} Ref Uno`, { createdAt: june(5) });
  await lead(loc0, "referral", "lost", `Demo Funnel ${label} Ref Dos`, {
    createdAt: june(6),
    lost: "Demo: precio",
  });
  await lead(loc1, "walk_in", "tour_booked", `Demo Funnel ${label} Walk Uno`, {
    createdAt: june(7),
  });

  // Working leads.
  const fresh = await lead(loc0, "web", "new", `Demo Lead ${label} Nuevo`, {
    ownerStaff: frontDesk,
  });
  await lead(loc1, "instagram", "contacted", `Demo Lead ${label} Sede Dos`);

  await c.query(
    "INSERT INTO app.lead_activity (org_id, lead_id, kind, body, by_person_id) VALUES ($1,$2,'note',$3,$4)",
    [org.orgId, fresh, "Demo: preguntó por horarios", org.people.front_desk],
  );

  const task = (
    loc: string,
    title: string,
    assignee: string,
    subject: { lead?: string; member?: string },
  ) =>
    c.query(
      `INSERT INTO app.crm_task (org_id, location_id, title, due_at, assigned_staff_id, lead_id, member_id, created_by)
       VALUES ($1,$2,$3, now() + interval '1 day', $4, $5, $6, $7)`,
      [
        org.orgId,
        loc,
        title,
        assignee,
        subject.lead ?? null,
        subject.member ?? null,
        org.people.front_desk,
      ],
    );
  await task(loc0, `Demo ${label}: llamar a lead nuevo`, frontDesk, { lead: fresh });
  await task(loc0, `Demo ${label}: seguimiento entrenamiento`, trainer, {
    member: org.members[0],
  });
  await task(loc1, `Demo ${label}: revisar sede dos`, owner, { member: org.members[1] });
}
