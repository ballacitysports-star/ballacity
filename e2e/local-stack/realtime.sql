-- Mounted into the supabase/postgres image's migrations by docker-compose.yml.
-- Realtime keeps its tenant registry in _realtime (DB_AFTER_CONNECT_QUERY), as in
-- Supabase's self-hosting compose. Harmless when the realtime service is not started.
\set pguser `echo "supabase_admin"`

CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO :pguser;
