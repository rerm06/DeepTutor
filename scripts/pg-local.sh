#!/usr/bin/env bash
# Ephemeral local Postgres 16 for tests and development, without Docker.
# Usage: scripts/pg-local.sh start|stop|status   (data in .pgdata/, port 54329, superuser "postgres", trust auth on localhost only)
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v pg_ctl)")}"
DATA="${PGDATA_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.pgdata}"
PORT="${PGPORT:-54329}"
run() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"; [ "$(id -u)" = "0" ] && chown postgres "$DATA"
      run "$PGBIN/initdb -D '$DATA' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    if ! run "$PGBIN/pg_ctl -D '$DATA' status" >/dev/null 2>&1; then
    run "$PGBIN/pg_ctl -D '$DATA' -o '-p $PORT -k /tmp -c listen_addresses=localhost' -l '$DATA/server.log' -w start >/dev/null"
    fi
    echo "postgres://postgres@localhost:$PORT/postgres" ;;
  stop) run "$PGBIN/pg_ctl -D '$DATA' -m fast stop" ;;
  status) run "$PGBIN/pg_ctl -D '$DATA' status" ;;
esac
