#!/usr/bin/env bash
# Mirror the canonical migrations into netlify/database/migrations with ordered, immutable names.
# --check: exit 1 if the mirror is stale (used by the gate). Never rename or edit a mirrored file once deployed:
# Netlify rejects modified or removed applied migrations. Add new numbered migrations instead.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=netlify/database/migrations
declare -a PAIRS=(
  "netlify/bootstrap_roles.sql:20261102000000_bootstrap_roles.sql"
)
for f in packages/db/migrations/*.sql; do
  b=$(basename "$f" .sql); n=$((10#${b%%_*})); slug=${b#*_}
  if [ "$n" -le 5 ]; then
    PAIRS+=("$f:2026110200$(printf '%04d' "$n")_${slug}.sql")
  else
    # Modules: schema at ...10NN00, its demo seed right after at ...10NN50, so later modules always sort last.
    PAIRS+=("$f:2026110210$(printf '%02d' "$n")00_${slug}.sql")
    seed="packages/db/seed/$(printf '%04d' "$n")_${slug}.sql"
    [ -f "$seed" ] && PAIRS+=("$seed:2026110210$(printf '%02d' "$n")50_${slug}_demo_seed.sql")
  fi
done
PAIRS+=("packages/db/seed/demo.sql:20261102009000_demo_seed.sql")
status=0
for pair in "${PAIRS[@]}"; do
  src=${pair%%:*}; dst=$OUT/${pair#*:}
  if [ "${1:-}" = "--check" ]; then
    cmp -s "$src" "$dst" || { echo "stale netlify migration: $dst (from $src)"; status=1; }
  else
    mkdir -p "$OUT"; cp "$src" "$dst"
  fi
done
if [ "${1:-}" = "--check" ]; then
  extra=$(comm -13 <(for p in "${PAIRS[@]}"; do echo "${p#*:}"; done | sort) <(ls "$OUT" | sort))
  [ -z "$extra" ] || { echo "unexpected netlify migrations: $extra"; status=1; }
fi
exit $status
