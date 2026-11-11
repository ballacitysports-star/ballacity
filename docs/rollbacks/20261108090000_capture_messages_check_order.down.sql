-- ROLLBACK for supabase/migrations/20261108090000_capture_messages_check_order.sql.
-- NOT a migration. The capture changes nothing on production (production already has this text), so there is nothing
-- to undo there except the ledger row. This removes only that row. The constraint stays as it is: both orders accept
-- exactly the same rows.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_capture_messages_check=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_capture_messages_check', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback removes the ledger row of 20261108090000. Set app.confirm_drop_capture_messages_check=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261108090000';
COMMIT;
