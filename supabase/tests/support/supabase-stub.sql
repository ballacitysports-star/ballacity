-- Stand-in for the parts of the Supabase platform that the migrations assume
-- already exist, so they can be replayed into a plain Postgres database:
--   * the API roles (anon, authenticated, service_role) and the default grants
--     Supabase gives them on new objects in public
--   * the auth, storage, realtime, vault and extensions schemas the
--     migrations reference, with just the tables and functions they touch
--   * auth.uid() reading the same request.jwt.claim.sub setting PostgREST sets
--
-- It is deliberately minimal. Add to it only when a migration needs something
-- that the real platform provides. Loaded by scripts/db-test.mjs.

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Roles are cluster-wide, so one may already exist from another database: make sure it can bypass RLS.
ALTER ROLE service_role BYPASSRLS;
DO $$ BEGIN CREATE ROLE supabase_auth_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_storage_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE postgres_stub NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path TO public, extensions', current_database()); END $$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz,
  is_anonymous boolean DEFAULT false, is_sso_user boolean DEFAULT false, confirmed_at timestamptz);
CREATE TABLE auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz, not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet);
CREATE TABLE auth.refresh_tokens (id bigserial PRIMARY KEY, user_id varchar, session_id uuid, revoked boolean, created_at timestamptz, updated_at timestamptz, token varchar);
CREATE TABLE auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, provider text, provider_id text, identity_data jsonb, email text, created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz);
CREATE TABLE auth.audit_log_entries (id uuid PRIMARY KEY, payload json, created_at timestamptz, ip_address varchar);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'email' $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, owner uuid, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), avif_autodetection boolean DEFAULT false, owner_id text);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, user_metadata jsonb, path_tokens text[], version text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT reverse(split_part(reverse(name), '.', 1)) $$;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
CREATE PUBLICATION supabase_realtime;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE IF NOT EXISTS realtime.messages (id bigserial PRIMARY KEY, topic text, extension text, payload jsonb, event text, private boolean, inserted_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('realtime.topic', true), '')::text $$;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text, secret text, key_id uuid, nonce bytea, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce, created_at, updated_at FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets(name, description, secret) VALUES (new_name, new_description, new_secret) RETURNING id $$;
-- Supabase's default privileges: new tables, functions and sequences in public are granted to the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
