#!/usr/bin/env bash
# Applies every file in supabase/migrations/ to DEST_DATABASE_URL, in
# filename order — the same order `supabase db push` would use, since
# migration filenames are timestamp-prefixed.
#
# Safe to re-run: applied filenames are recorded in a tracking table
# (own_migration_status.applied_migrations) so an interrupted run resumes
# instead of re-applying files whose CREATE TABLE/CREATE POLICY etc. would
# then fail on "already exists". This is deliberately separate from
# Supabase's own `supabase_migrations.schema_migrations` table so this
# script never has to assume the CLI is installed or already linked.
#
#   DEST_DATABASE_URL=postgresql://postgres:...@db.olrbulvwexrkjcxddjxq.supabase.co:5432/postgres \
#     ./apply-schema.sh
#
# Use the DIRECT connection string (Settings -> Database -> "Use direct
# connection"), not the pgbouncer pooler — several migrations run inside
# implicit transactions and DDL that the transaction pooler can mishandle.
set -euo pipefail

if [ -z "${DEST_DATABASE_URL:-}" ]; then
  echo "Missing DEST_DATABASE_URL. See README.md for where to find it." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../../supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Can't find supabase/migrations at $MIGRATIONS_DIR" >&2
  exit 1
fi

echo "Verifying connection to destination..."
psql "$DEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null

psql "$DEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists own_migration_status;
create table if not exists own_migration_status.applied_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
SQL

total=0
applied=0
skipped=0
failed=""

for f in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$f")"
  total=$((total + 1))

  already="$(psql "$DEST_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "select 1 from own_migration_status.applied_migrations where filename = '$name'")"

  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "Applying $name..."
  if psql "$DEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; then
    psql "$DEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
      -c "insert into own_migration_status.applied_migrations (filename) values ('$name')" >/dev/null
    applied=$((applied + 1))
  else
    echo "FAILED on $name — stopping. Fix the error above, then re-run this" >&2
    echo "script; everything before $name is recorded and will be skipped." >&2
    failed="$name"
    break
  fi
done

echo
echo "Total migration files: $total"
echo "Newly applied:         $applied"
echo "Already applied:       $skipped"
if [ -n "$failed" ]; then
  echo "Stopped at:             $failed"
  exit 1
fi
echo "Schema is fully applied."
