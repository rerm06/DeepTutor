# ADR 0001 — Tenancy enforced in Postgres with RLS and three roles

Status: accepted (cycle 1). Context: spec §3.1 requires org/location isolation that survives application bugs.

Decision
- One shared database; every org-scoped row has `org_id`; RLS ENABLED and FORCED on every table.
- Claims (`sub`, `org_id`, `app_role`, `location_ids`) are bound per transaction from a verified JWT.
  `app_role` avoids clashing with the Postgres `role` claim used by Supabase-style gateways.
- Roles: `app_owner` (migrations), `app_api` (LOGIN, NOINHERIT, no privileges), `app_authenticated` (policies apply),
  `app_definer` (BYPASSRLS, owns only audited definer functions that re-check claims).
- Composite foreign keys `(org_id, id)` make cross-org references impossible even for a faulty writer.

Rejected: database-per-tenant (operational cost at hundreds of gyms, spec §4); app-level filtering only (one missed
`WHERE` leaks data); Supabase `service_role` in request paths (spec §3.1 forbids it).

Consequences
- Membership in two orgs = two tokens; switching org re-issues the token.
- `register_member` with an email that already exists links the global Person. This is an existence oracle for
  emails across orgs (a 409 never happens, but linking is observable to the person). Accepted; revisit with the IdP.
- Fixtures in tests use a superuser connection only for setup; every assertion runs as `app_api`.
