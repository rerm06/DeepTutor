#!/usr/bin/env bash
# The loop's objective gate (docs/loop.md). Exit 0 only if every check passes. Never skip or weaken a check.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== secrets scan"; ! git grep --untracked -nE '(sk_live_|rk_live_|whsec_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)' -- . ':!scripts/gate.sh'
echo "== forbidden terms (spec §6.7: AI is never a 'nutricionista')"; ! git grep --untracked -niE 'agente nutricionista|ai nutritionist|nutricionista (virtual|ia|con ia)' -- 'apps' 'packages' 'services' 2>/dev/null
echo "== lint"; pnpm -s lint
echo "== build"; pnpm -r --reporter=append-only build
echo "== typecheck"; pnpm -s typecheck
if [ -z "${TEST_PG_ADMIN_URL:-}" ]; then
  url="$(bash scripts/pg-local.sh start)"   # separate assignment so a failed start aborts the gate
  export TEST_PG_ADMIN_URL="$url"
fi
echo "== tests (Postgres: $TEST_PG_ADMIN_URL)"; pnpm -s test
echo "GATE: PASS"
