#!/usr/bin/env bash
# Copies table DATA (not schema — run apply-schema.sh first) from the source
# project to the destination project: every table in the public schema,
# plus auth.users and auth.identities, which existing accounts — including
# Google/Apple/Microsoft sign-in — need to keep working after cutover.
#
# Deliberately excludes auth.sessions, auth.refresh_tokens, auth.flow_state,
# auth.one_time_tokens, auth.mfa_*, auth.sso_*, auth.instances,
# auth.audit_log_entries, and auth.schema_migrations — see README.md's
# "Known-safe mismatches". storage.* is handled separately by
# copy-storage.mjs: real files have to move through the Storage API, since a
# copied storage.objects row pointing at bytes that were never uploaded to
# the destination is a dangling reference, not a working file.
#
# Uses pg_dump's custom format so pg_restore loads tables in FK-dependency
# order automatically, and --disable-triggers so per-row triggers (updated_at
# stamping, notification fanout, denormalized counters, audit logging) don't
# re-fire for events that already happened once on the source. That flag's
# generated commands must run as a superuser-equivalent role — Supabase's
# `postgres` role qualifies; if it errors on permissions for you, the
# fallback is `SET session_replication_role = replica;` for the same effect
# (see Supabase's own project-migration docs).
#
#   SOURCE_DATABASE_URL=postgresql://... DEST_DATABASE_URL=postgresql://... \
#     ./copy-database.sh
#
# Both must be DIRECT connections (Settings -> Database -> "Use direct
# connection"), not the pgbouncer pooler — see README.md.
set -euo pipefail

if [ -z "${SOURCE_DATABASE_URL:-}" ] || [ -z "${DEST_DATABASE_URL:-}" ]; then
  echo "Missing SOURCE_DATABASE_URL and/or DEST_DATABASE_URL. See README.md." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
DUMP_FILE="$WORKDIR/data.dump"

echo "Verifying connections..."
psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null
psql "$DEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null

echo "Dumping data from source (public.* + auth.users + auth.identities)..."
pg_dump "$SOURCE_DATABASE_URL" \
  --data-only \
  --no-owner \
  --no-privileges \
  --format=custom \
  --table='public.*' \
  --table='auth.users' \
  --table='auth.identities' \
  --verbose \
  --file="$DUMP_FILE"

echo "Restoring into destination..."
pg_restore \
  --data-only \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --dbname="$DEST_DATABASE_URL" \
  --verbose \
  "$DUMP_FILE"

echo
echo "Data copy complete. Run verify-parity.mjs next before touching anything else."
