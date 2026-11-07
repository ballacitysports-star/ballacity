-- ROLLBACK for supabase/migrations/20261103110000_capture_structured_reviews.sql.
-- NOT a migration. The capture is a no-op on production: the structured-review columns, constraint and functions were
-- applied there by hand before it existed, and reviews may hold data in recommend / answers / tags. So this rollback
-- removes ONLY the ledger row. It deliberately does not drop columns, the constraint or functions: that would delete
-- review data and roll production's behaviour back.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_capture_structured_reviews=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_capture_structured_reviews', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback removes the ledger row of 20261103110000 (and nothing else). Set app.confirm_drop_capture_structured_reviews=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261103110000';
COMMIT;
