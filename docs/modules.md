# Module swarm — conventions (read with AGENTS.md and docs/prompts/loop-architect.md)

Each module is built by one agent in its own git worktree and branch, touching ONLY its own files, so branches merge
without conflicts. Shared wiring (registries) already exists; do not edit it.

| id | Migration | Spec | Scope |
|---|---|---|---|
| billing | 0006 | §5, E3, E4 | Catalogue, prices, subscriptions, freezes, invoices with IVU, payments, credits, day passes (Stripe adapter stub only) |
| schedule | 0007 | §3.2, E6 | Classes, sessions, bookings, waitlist, appointments, check-in, rotating QR credential |
| crm | 0008 | E9, §7 retention | Leads, pipeline, activities, tasks, lead→member conversion |
| store | 0009 | E5, E11, §11 suplementos | Products, inventory per location, sales (POS/online), IVU per item, age check, transfers, reorder |
| health | 0010 | §6.1–6.2, §6.6–6.7 | Assessment (PAR-Q+), deterministic triage, care plans with licensed sign-off |
| floor | 0011 | §6.4 | Assets, issues, exercise taxonomy, circuits, set logs, substitution by movement pattern |
| engagement | 0012 | §9 | Points ledger, rules, challenges, badges, referrals, moderated community wall |
| finance | 0013 | §8 | Vendors, bills + approvals, expenses, commissions, P&L by location, journal export (wave B) |
| reports | 0014 | E13 | Dashboard KPIs, peak-hours heatmap, overdue, expiring, IVU by municipality, exports (wave B) |
| signup | 0018 | E7, §11 | Public self-service "Únete" page, online member registration, agreements, per-location switch (wave C; public routes and `/join` wired in `app.ts` / `App.tsx`) |

## Files a module owns (and nothing else)
- `packages/db/migrations/00NN_<id>.sql` — schema, RLS (ENABLE + FORCE), policies, column-level grants, definer functions.
- `packages/db/seed/00NN_<id>.sql` — DEMO seed for Netlify (synthetic, idempotent, uses the core demo UUIDs in
  `packages/shared/src/demo.ts`; lift FORCE RLS only on your tables and restore it, like `seed/demo.sql`).
- `packages/db/src/fixtures/<id>.ts` — test fixtures: ≥1 row per org in EVERY table you add (the matrix test fails otherwise).
- `packages/db/test/<id>.test.ts`, `apps/api/test/<id>.test.ts` — your tests.
- `apps/api/src/modules/<id>.ts` — Fastify routes (already registered under `/v1`).
- `packages/shared/src/modules/<id>.ts` — shared types/constants (already re-exported).
- `apps/web/src/modules/<id>/**` — screens, components, local ES/EN dictionary (`defineDict` + `useModuleT`), the
  `module` export (routes, nav, memberTabs) consumed by `apps/web/src/modules/registry.ts`.
- `docs/modules/<id>.md` — short doc: data model, rules, endpoints, open questions ([VERIFICAR]).

## Rules
- Reference only core objects (migrations 0001–0005) from wave-A modules; wave B may reference every module.
- Every org-scoped table: `org_id uuid NOT NULL DEFAULT app.org_id()`, `UNIQUE (org_id, id)`, composite FKs
  `(org_id, x_id)`, RLS ENABLE + FORCE, explicit policies, column-level INSERT/UPDATE grants to `app_authenticated`,
  and nothing granted to PUBLIC. Cross-RLS work → `SECURITY DEFINER` function owned by `app_definer`,
  `SET search_path = app, pg_temp`, re-check claims and location scope, `REVOKE ALL … FROM PUBLIC`, explicit GRANT.
  `app_definer` already reaches all `app.*` rows through the `definer_all` policies created in 0005 — **but 0005 ran
  before your tables existed**, so add `CREATE POLICY definer_all ON app.<table> TO app_definer USING (true) WITH CHECK (true)`
  for each of your tables.
- Audit every money or status change (definer functions call `app.audit(...)`, or add an AFTER trigger like
  `member_audit`).
- Money in integer cents. IVU in PR: 10.5 % state + 1 % municipal on taxable lines, rounded per line [VERIFICAR · CPA].
- No new npm dependencies (qrcode is already in apps/web). No Stripe/Twilio/LLM calls: provide adapters/stubs only.
- UI: ES/EN via your local dictionary, WCAG 2.2 AA, 360 px without horizontal scroll, `data-tour-id` on critical
  controls, reuse `components/ui.tsx` and the CSS classes in `styles.css` (add module CSS in your folder if needed).
- Health data: visible only to the member, their guardian, and the roles that act on it at the member's location —
  trainer, licensed nutrition specialist, clinician, location manager — plus the owner org-wide (oversight); never to
  front desk, chef or accountant [VERIFICAR · legal: confirm owner/manager access and minimum-necessary under HIPAA/PR].
- Care plans: the licensed author may approve their own plan (the professional signs their own work, spec §6.7);
  a second reviewer is a [P] option per organisation, not enforced. Never use the regulated nutrition titles in UI or data.
- Verify in your worktree: `pnpm install`, `bash scripts/sync-netlify-migrations.sh`, `bash scripts/gate.sh` → `GATE: PASS`.
