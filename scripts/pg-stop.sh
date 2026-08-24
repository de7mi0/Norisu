#!/usr/bin/env bash
#
# Stops the local Postgres started by ./scripts/pg-start.sh.
#
#   ./scripts/pg-stop.sh
#
# The cluster's files stay in /var/tmp, so starting it again is instant.
set -euo pipefail

PGDATA="${PGDATA:-/var/tmp/saloni-pg}"
PGHOST="${PGHOST:-/var/tmp}"
PGPORT="${PGPORT:-5433}"

bindir=""
if command -v pg_ctl >/dev/null 2>&1; then
  bindir="$(dirname "$(command -v pg_ctl)")"
else
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -Vr); do
    if [ -x "$candidate/pg_ctl" ]; then bindir="$candidate"; break; fi
  done
fi

if [ -z "$bindir" ]; then
  echo "No Postgres server tools found to stop it with." >&2
  exit 1
fi

isready="$bindir/pg_isready"
[ -x "$isready" ] || isready="pg_isready"

if ! "$isready" -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "Postgres is not running on $PGHOST:$PGPORT."
  exit 0
fi

if [ "$(id -u)" = 0 ]; then
  as_postgres() { su postgres -c "$1"; }
else
  as_postgres() { bash -c "$1"; }
fi

as_postgres "'$bindir/pg_ctl' -D '$PGDATA' -m fast -w stop" >/dev/null
echo "Postgres stopped."
