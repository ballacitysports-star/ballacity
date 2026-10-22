-- Minimal Supabase stand-ins (auth.users, auth.uid(), storage, realtime, cron, net, vault and the
-- API roles) for replaying supabase/migrations + drizzle/migrations on vanilla Postgres 16.
-- Test-only. Never run against a real project.
-- Minimal Supabase stubs for replaying the migration chain on vanilla Postgres 16.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOINHERIT LOGIN; GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE supabase_admin; CREATE ROLE supabase_auth_admin; CREATE ROLE supabase_storage_admin; CREATE ROLE dashboard_user; CREATE ROLE postgres_fdw_user;
CREATE SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
ALTER DATABASE replay SET search_path TO public, extensions;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  instance_id uuid, id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz, invited_at timestamptz, confirmation_token text,
  confirmation_sent_at timestamptz, recovery_token text, recovery_sent_at timestamptz, email_change_token_new text,
  email_change text, email_change_sent_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb, raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  is_super_admin boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  phone text, phone_confirmed_at timestamptz, phone_change text, phone_change_token text, phone_change_sent_at timestamptz,
  confirmed_at timestamptz, email_change_token_current text, email_change_confirm_status smallint,
  banned_until timestamptz, reauthentication_token text, reauthentication_sent_at timestamptz,
  is_sso_user boolean DEFAULT false, deleted_at timestamptz, is_anonymous boolean DEFAULT false);
CREATE TABLE auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, provider text, provider_id text, identity_data jsonb, email text, last_sign_in_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, created_at timestamptz DEFAULT now(), updated_at timestamptz, not_after timestamptz, aal text);
CREATE TABLE auth.refresh_tokens (id bigserial PRIMARY KEY, user_id text, session_id uuid, token text, revoked boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE auth.mfa_factors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text, factor_type text, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.email', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, owner uuid, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], avif_autodetection boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), owner_id text, type text);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED, version text, user_metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(name, '.', -1) $$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
CREATE SCHEMA realtime; CREATE TABLE realtime.messages (id bigserial, topic text, extension text, payload jsonb, event text, private boolean, inserted_at timestamptz DEFAULT now());
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
CREATE PUBLICATION supabase_realtime;
CREATE SCHEMA cron; CREATE FUNCTION cron.schedule(a text, b text, c text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION cron.schedule(b text, c text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION cron.unschedule(a text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE SCHEMA net; CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 1000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA vault; CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret, description FROM vault.secrets;
CREATE FUNCTION vault.create_secret(secret text, name text DEFAULT NULL, description text DEFAULT '') RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets(name, secret, description) VALUES (name, secret, description) RETURNING id $$;
