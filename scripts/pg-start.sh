#!/usr/bin/env bash
#
# Starts the local Postgres that ./scripts/test-db.sh runs against, creating the
# cluster first if this machine has never had one.
#
#   ./scripts/pg-start.sh
#
# Safe to run twice: if the server is already accepting connections it says so
# and does nothing. test-db.sh calls this itself, so you only need it directly
# if you want a database to poke at with psql:
#
#   psql -h /var/tmp -p 5433 -U postgres
#
# Stop the server with ./scripts/pg-stop.sh.
#
# The cluster lives in /var/tmp on purpose. It holds nothing worth keeping — the
# tests build and drop their own database every run — so losing it on reboot
# costs one initdb.
set -euo pipefail

PGDATA="${PGDATA:-/var/tmp/saloni-pg}"
PGHOST="${PGHOST:-/var/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
LOG="${SALONI_PG_LOG:-/var/tmp/saloni-pg.log}"

export PGHOST PGPORT PGUSER

# Postgres refuses to run as root, so when we are root everything goes through
# the postgres system account. Elsewhere we are already the right user.
if [ "$(id -u)" = 0 ]; then
  if ! id -u postgres >/dev/null 2>&1; then
    echo "Running as root but there is no 'postgres' user to run the server as." >&2
    exit 1
  fi
  as_postgres() { su postgres -c "$1"; }
  own() { chown -R postgres:postgres "$1"; }
else
  as_postgres() { bash -c "$1"; }
  own() { :; }
fi

# The client tools are on PATH on most machines; the server ones often are not,
# because Debian keeps them per-version.
bindir=""
if command -v pg_ctl >/dev/null 2>&1; then
  bindir="$(dirname "$(command -v pg_ctl)")"
else
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -Vr); do
    if [ -x "$candidate/pg_ctl" ]; then bindir="$candidate"; break; fi
  done
fi

if [ -z "$bindir" ]; then
  echo "No Postgres server found. Install Postgres 16 (the version the tests are written against)." >&2
  echo "On Debian/Ubuntu: apt-get install -y postgresql-16" >&2
  exit 1
fi

if pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "Postgres is already running on $PGHOST:$PGPORT."
  exit 0
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Creating the test cluster in $PGDATA (first run only)…"
  mkdir -p "$PGDATA"
  own "$PGDATA"
  # trust auth: the server listens on a Unix socket only, so nothing off this
  # machine can reach it, and the tests need to become anon/authenticated freely.
  as_postgres "'$bindir/initdb' -D '$PGDATA' -U '$PGUSER' --auth=trust" >/dev/null
fi

echo "Starting Postgres on $PGHOST:$PGPORT…"
as_postgres "'$bindir/pg_ctl' -D '$PGDATA' -o \"-k $PGHOST -p $PGPORT -c listen_addresses=''\" -l '$LOG' -w start" >/dev/null

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT"; then
  echo "Postgres did not come up. The last few lines of $LOG:" >&2
  tail -20 "$LOG" >&2 || true
  exit 1
fi

echo "Postgres is up."
