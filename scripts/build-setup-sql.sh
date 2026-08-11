#!/usr/bin/env bash
#
# Concatenates the migrations into supabase/setup.sql — a single file that can
# be pasted into the Supabase SQL Editor in one go.
#
# Run this after changing anything under supabase/migrations/.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/supabase/setup.sql"

{
  cat <<'HEADER'
-- Saloni — complete database setup
--
-- GENERATED FILE. Do not edit directly: it is built from supabase/migrations/
-- by scripts/build-setup-sql.sh. Edit the migrations and regenerate.
--
-- Paste the whole file into the Supabase SQL Editor and run it once. It creates
-- every table, constraint and security policy the app needs.

HEADER

  for migration in "$root"/supabase/migrations/*.sql; do
    printf -- '-- ===========================================================================\n'
    printf -- '-- %s\n' "$(basename "$migration")"
    printf -- '-- ===========================================================================\n\n'
    cat "$migration"
    printf '\n\n'
  done
} > "$out"

echo "Wrote $out ($(wc -l < "$out") lines)"
