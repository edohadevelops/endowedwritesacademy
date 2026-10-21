#!/usr/bin/env bash
# Applies the migrations to a fresh PostgreSQL database and runs the RLS tests.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="endowed_rls_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/db/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
psql -q -t -A -o /dev/null -v ON_ERROR_STOP=1 -d "$DB" -f tests/db/10_rls_tests.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
