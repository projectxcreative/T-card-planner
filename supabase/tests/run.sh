#!/usr/bin/env bash
# Runs the migrations and the access tests against a throwaway local Postgres.
# Needs Postgres 15+ binaries (initdb, pg_ctl, psql) on PATH or in
# /usr/lib/postgresql/<version>/bin. No Supabase account or Docker required.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"

if ! command -v initdb >/dev/null; then
  bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$bin" ] && PATH="$bin:$PATH"
fi

data="$(mktemp -d)"
sock="$(mktemp -d)"
port=54329
as_pg=()
if [ "$(id -u)" = 0 ]; then
  chown postgres "$data" "$sock"
  as_pg=(runuser -u postgres --)
fi

cleanup() { "${as_pg[@]}" pg_ctl -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data" "$sock"; }
trap cleanup EXIT

"${as_pg[@]}" initdb -D "$data" -U postgres -A trust >/dev/null
"${as_pg[@]}" pg_ctl -D "$data" -o "-k $sock -p $port -c listen_addresses=''" -w start >/dev/null

psql_run() { "${as_pg[@]}" psql -X -q -v ON_ERROR_STOP=1 -h "$sock" -p "$port" -U postgres -d postgres "$@"; }

psql_run -f "$here/supabase_stub.sql"
for migration in "$root"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$migration")"
  psql_run -f "$migration"
done
psql_run -o /dev/null -f "$here/access.test.sql"

node "$root/scripts/board-to-sql.mjs" "$here/fixtures/board.json" 2>/dev/null | psql_run -o /dev/null
psql_run -f "$here/import.test.sql"
