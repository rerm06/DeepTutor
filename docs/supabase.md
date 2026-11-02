# Supabase: same database, new project

The schema, RLS model and demo data are the Netlify migration set (`netlify/database/migrations`, ordered and
SHA-256 pinned). `scripts/supabase-apply.sh` applies exactly those files to a Supabase project, in order, each in
its own transaction, and records them in `public.gym_migrations` (RLS on, no policies: invisible to the Supabase
`anon`/`authenticated` roles). Re-running applies only new files and refuses drift.

## Run
- From a machine that can reach Supabase Postgres (5432/6543):
  `SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-us-east-2.pooler.supabase.com:5432/postgres' bash scripts/supabase-apply.sh`
- From a sandbox where TCP to Postgres is blocked: a Supabase personal access token, as an environment secret
  (never in the repo or chat): `SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=<ref> bash scripts/supabase-apply.sh`.

Verified locally on a fresh database owned by a non-superuser role (as on Supabase): 36 files in ~9 s; second run
applies nothing.

## Notes
- Tables live in schema `app` (not `public`), so Supabase's auto REST API does not expose them; access stays
  through the API, which binds signed claims and drops to `app_authenticated` per transaction.
- To point the deployed API at Supabase, set `GYM_DB_URL` in Netlify to the Supabase **session** pooler URL
  (port 5432; transaction pooling breaks `SET LOCAL ROLE` + session-bound claim checks) [VERIFICAR in staging].
- Run the Supabase security advisors after applying.
