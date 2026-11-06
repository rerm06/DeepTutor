#!/usr/bin/env bash
# Apply the exact Netlify migration set (netlify/database/migrations, already ordered and SHA-pinned) to a Supabase
# Postgres database. Two transports, same files:
#   psql (from a machine that can reach Supabase on 5432/6543):
#     SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#       bash scripts/supabase-apply.sh
#   Management API over HTTPS (when TCP to Postgres is blocked, e.g. a cloud sandbox):
#     SUPABASE_ACCESS_TOKEN=<personal access token> SUPABASE_PROJECT_REF=<ref> bash scripts/supabase-apply.sh
# Each file runs once and is recorded in public.gym_migrations, so re-running only applies new files.
# Never commit credentials; pass them as environment variables.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=netlify/database/migrations
(cd "$DIR" && sha256sum --quiet -c ../applied-migrations.sha256) || { echo "applied migrations changed: refusing"; exit 1; }

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  run_sql() { psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X "$@"; }
  run_sql -c "CREATE TABLE IF NOT EXISTS public.gym_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); ALTER TABLE public.gym_migrations ENABLE ROW LEVEL SECURITY;"
  for f in "$DIR"/*.sql; do
    n=$(basename "$f" .sql); h=$(sha256sum "$f" | cut -d' ' -f1)
    done_h=$(psql "$SUPABASE_DB_URL" -At -X -c "SELECT sha256 FROM public.gym_migrations WHERE name = '$n'")
    if [ -n "$done_h" ]; then
      [ "$done_h" = "$h" ] || { echo "drift: $n was applied with a different content"; exit 1; }
      continue
    fi
    echo "applying $n"
    { echo "BEGIN;"; cat "$f"; echo; echo "INSERT INTO public.gym_migrations (name, sha256) VALUES ('$n', '$h');"; echo "COMMIT;"; } | run_sql
  done
elif [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  api() {
    node -e '
      const fs = require("fs");
      const body = JSON.stringify({ query: fs.readFileSync(0, "utf8") });
      fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body,
      }).then(async (r) => { const t = await r.text(); if (!r.ok) { console.error(r.status, t); process.exit(1); } process.stdout.write(t); });'
  }
  echo "CREATE TABLE IF NOT EXISTS public.gym_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); ALTER TABLE public.gym_migrations ENABLE ROW LEVEL SECURITY;" | api >/dev/null
  applied=$(echo "SELECT coalesce(json_agg(json_build_object('n', name, 'h', sha256)), '[]') AS a FROM public.gym_migrations;" | api)
  for f in "$DIR"/*.sql; do
    n=$(basename "$f" .sql); h=$(sha256sum "$f" | cut -d' ' -f1)
    prev=$(node -e 'const a=JSON.parse(process.argv[1])[0].a; const r=a.find(x=>x.n===process.argv[2]); console.log(r?r.h:"")' "$applied" "$n")
    if [ -n "$prev" ]; then
      [ "$prev" = "$h" ] || { echo "drift: $n was applied with a different content"; exit 1; }
      continue
    fi
    echo "applying $n"
    { echo "BEGIN;"; cat "$f"; echo; echo "INSERT INTO public.gym_migrations (name, sha256) VALUES ('$n', '$h');"; echo "COMMIT;"; } | api >/dev/null
  done
else
  echo "set SUPABASE_DB_URL, or SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF"; exit 2
fi
echo "done"
