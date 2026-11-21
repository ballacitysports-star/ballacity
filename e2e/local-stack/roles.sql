-- Mounted into the supabase/postgres image's init scripts by docker-compose.yml.
-- The service roles exist in the image without a usable password; give them the
-- password generated for this run (POSTGRES_PASSWORD), as Supabase's own self-hosting
-- compose does. Local, throwaway database only.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
