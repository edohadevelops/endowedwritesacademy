#!/usr/bin/env bash
# Starts the local Supabase stand-in: Postgres DB + GoTrue + PostgREST + proxy.
# Requires: PGHOST/PGPORT/PGUSER for a superuser connection, BIN_DIR with binaries.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${SUPA_DB:-endowed_supa}
BIN_DIR=${BIN_DIR:?set BIN_DIR to the folder with postgrest and auth/gotrue}
LOG_DIR=${LOG_DIR:-/tmp/endowed-supa-logs}
mkdir -p "$LOG_DIR"
SECRET=$(node -e "import('./tests/supabase-local/keys.mjs').then(m=>console.log(m.JWT_SECRET))")
PW=local-test-password
PGTCP="host=localhost port=${PGPORT}"

# Fresh database and the roles Supabase normally creates.
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password '$PW'; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login superuser password '$PW'; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
create schema if not exists auth authorization supabase_auth_admin;
SQL

export GOTRUE_DB_DRIVER=postgres
export DATABASE_URL="postgres://supabase_auth_admin:$PW@localhost:${PGPORT}/$DB?search_path=auth&sslmode=disable"
export GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_JWT_ADMIN_ROLES=service_role
export API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_SITE_URL=http://localhost:5174
export GOTRUE_URI_ALLOW_LIST="http://localhost:5174/**"
export GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true
export GOTRUE_SMTP_HOST="" GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
export PORT=9999 GOTRUE_API_HOST=127.0.0.1 GOTRUE_LOG_LEVEL=warn
(cd "$BIN_DIR/auth" && ./gotrue migrate) > "$LOG_DIR/gotrue-migrate.log" 2>&1
(cd "$BIN_DIR/auth" && ./gotrue serve) > "$LOG_DIR/gotrue.log" 2>&1 &
echo $! > "$LOG_DIR/gotrue.pid"

# Storage stand-in schema, then this project's migrations.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/supabase-local/storage-shim.sql
if [ -n "${SETUP_SQL:-}" ]; then
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SETUP_SQL"   # e.g. supabase/dashboard/setup.sql
else
  for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
fi
psql -q -d "$DB" -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; notify pgrst, 'reload schema';"

cat > "$LOG_DIR/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$PW@localhost:${PGPORT}/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3000
server-host = "127.0.0.1"
CONF
"$BIN_DIR/postgrest" "$LOG_DIR/postgrest.conf" > "$LOG_DIR/postgrest.log" 2>&1 &
echo $! > "$LOG_DIR/postgrest.pid"

node --import ./tests/supabase-local/register.mjs tests/supabase-local/proxy.mjs > "$LOG_DIR/proxy.log" 2>&1 &
echo $! > "$LOG_DIR/proxy.pid"

for i in $(seq 1 40); do
  if curl -s -o /dev/null http://localhost:54321/auth/v1/health && curl -s -o /dev/null http://127.0.0.1:3000/; then echo "stand-in ready"; exit 0; fi
  sleep 0.5
done
echo "stand-in failed to start; see $LOG_DIR"; tail -20 "$LOG_DIR"/*.log; exit 1
