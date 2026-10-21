# Local Supabase stand-in (for tests only)

Runs the real Supabase Auth (GoTrue) and PostgREST binaries against a local
PostgreSQL with this project's migrations, plus a small Node proxy that
serves them under Supabase's URL layout (`/auth/v1`, `/rest/v1`), runs the
`submit-comment` Edge Function in Node, and provides an in-memory stand-in
for Storage. It lets `tests/e2e/supabase.spec.ts` exercise the Supabase
adapter end to end without Docker.

It is not used in production. For real local development with Supabase,
use the Supabase CLI (`supabase start`), which needs Docker.

    BIN_DIR=/path/to/binaries PGHOST=... PGPORT=... tests/supabase-local/start.sh

`BIN_DIR` must contain `postgrest` and `auth/gotrue` (with `auth/migrations`).
