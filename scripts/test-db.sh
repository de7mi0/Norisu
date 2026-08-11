#!/usr/bin/env bash
#
# Applies the migrations to a throwaway Postgres database and runs the schema
# and policy assertions against it.
#
#   ./scripts/test-db.sh
#
# Requires a running Postgres. Override the connection with PGHOST/PGPORT/PGUSER.
set -euo pipefail

PGHOST="${PGHOST:-/var/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
DB="saloni_test_$$"

export PGHOST PGPORT PGUSER

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
