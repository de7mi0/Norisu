#!/usr/bin/env bash
#
# Applies the migrations to a throwaway Postgres database and runs the schema
# and policy assertions against it.
#
#   ./scripts/test-db.sh
#
# Starts a local Postgres itself if one isn't running, creating the cluster on
# the first run — see scripts/pg-start.sh. Point it at a Postgres of your own
# instead with PGHOST/PGPORT/PGUSER, and it will leave the starting to you.
set -euo pipefail

PGHOST="${PGHOST:-/var/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
DB="saloni_test_$$"

export PGHOST PGPORT PGUSER

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! pg_isready -q 2>/dev/null; then
  # Only start a server on the connection we own. Anything else is somebody
  # else's database and starting ours would not make it reachable anyway.
  if [ "$PGHOST" = /var/tmp ] && [ "$PGPORT" = 5433 ]; then
    "$root/scripts/pg-start.sh"
    echo
  else
    echo "No Postgres accepting connections on $PGHOST:$PGPORT." >&2
    echo "Start it, or unset PGHOST/PGPORT to use the one ./scripts/pg-start.sh manages." >&2
    exit 1
  fi
fi

cleanup() {
  psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -q -d postgres -c "create database $DB"

run() {
  echo "── $(basename "$1")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"
}

run "$root/supabase/tests/00_local_shim.sql"
for migration in "$root"/supabase/migrations/*.sql; do
  run "$migration"
done
run "$root/supabase/tests/01_policy_tests.sql"

echo
echo "Database tests passed."
