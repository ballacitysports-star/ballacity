-- ROLLBACK for supabase/migrations/20261031120000_close_live_write_holes.sql (PR #287, audit F02/F11/F12/F13)
--
-- NOT a migration: it lives outside supabase/migrations on purpose so no replay or migration tool runs it. It removes
-- what 20261031120000 added and restores the two review policies it replaced, exactly as `main` defined them before it
-- (20261012120000 and 20260915225632). Verified: a replay of main + 20261031120000 + this file (parts=all) has the same
-- catalog (functions, grants, tables, columns, policies, triggers) as a replay of main alone, on PG16 and PG17; each part
-- alone removes only its own objects (docs/release/hotfix-286-287-runbook.md, "Rollback").
--
-- THIS RE-OPENS THE LIVE WRITE PATHS THE HOTFIX CLOSES:
--   * roster rows can be re-pointed at any person, including a minor (F02);
--   * players can write refund_* fields on their own payment claims (F11);
--   * reviews written straight through the API are public without screening (F12);
--   * moderators can rewrite reports and reviewer attribution without an audit row (F13).
-- It therefore refuses to run unless the session says, on purpose, that this is intended, and it undoes only the parts
-- you name. psql only (it uses \if); run it from the repository root:
--
--   PGOPTIONS="-c app.confirm_reopen_live_write_holes=yes" \
--     psql -X -v ON_ERROR_STOP=1 -v parts=<parts> --single-transaction -f docs/rollbacks/20261031120000_close_live_write_holes.down.sql
--
--   parts = all, or a comma list of the independent parts:
--     1  roster identity lock      (team_members)
--     2  refund-field lock         (payment_submissions)
--     3  review screening hold     (reviews). ROLL THE APP BACK FIRST: the #287 app build relies on the database hold;
--                                  with the hold gone it would publish reviews the AI screening sent for human review.
--                                  The previous build works with either database state.
--     4  report guard and audit    (user_reports)
--
-- PREFER A FORWARD FIX, and undo only the part that misbehaves. --single-transaction makes it apply whole or not at all.
--
-- Data: nothing is deleted from reviews, reports, payments or rosters. Reviews still held for screening when part 3 runs
-- stay flagged (hidden): a NOTICE gives their number, and superadmins decide them in Moderation (reviews, hidden only).
-- The hold bookkeeping table is dropped.
-- Ledger: the 20261031120000 row stays; record the rollback with it. (Corrected 2026-11-11: main has no release
-- preflight; the pinned_history check that would refuse this state exists only in the unmerged PR #294. On main,
-- docs/release/hotfix-287-verify.sql shows the rolled-back part as no longer matching.)
--
-- Do it only with the owner's explicit approval, and record it.

DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_live_write_holes', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback re-opens the live write paths closed by 20261031120000 (roster re-pointing, refund fields, unscreened reviews, report rewrites). Read the header of this file; to proceed deliberately set app.confirm_reopen_live_write_holes=yes.';
  END IF;
END
$guard$;

\if :{?parts}
\else
  \set parts ''
\endif
SELECT set_config('app.rollback_20261031120000_parts', :'parts', true);
DO $parts$
BEGIN
  IF current_setting('app.rollback_20261031120000_parts') !~ '^(all|[1-4](,[1-4])*)$' THEN
    RAISE EXCEPTION 'Refusing to run: name the parts to undo with -v parts=all or a comma list such as -v parts=3 or -v parts=2,4 (see the header).';
  END IF;
END
$parts$;
SELECT :'parts' = 'all' OR :'parts' ~ '(^|,)1(,|$)' AS rb_part1,
       :'parts' = 'all' OR :'parts' ~ '(^|,)2(,|$)' AS rb_part2,
       :'parts' = 'all' OR :'parts' ~ '(^|,)3(,|$)' AS rb_part3,
       :'parts' = 'all' OR :'parts' ~ '(^|,)4(,|$)' AS rb_part4 \gset

\if :rb_part1
-- 1. roster identity lock (team_members)
DROP TRIGGER IF EXISTS a0_team_members_identity_locked ON public.team_members;
DROP FUNCTION IF EXISTS public.lock_member_row_identity();
\endif

\if :rb_part2
-- 2. refund-field lock (payment_submissions)
DROP TRIGGER IF EXISTS a00_payment_refund_fields_locked ON public.payment_submissions;
DROP FUNCTION IF EXISTS public.lock_payment_refund_fields();
\endif

\if :rb_part3
-- 3. review screening hold (reviews)
DO $held$
DECLARE _n integer;
BEGIN
  IF to_regclass('private_sec.review_screening_holds') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM private_sec.review_screening_holds h JOIN public.reviews r ON r.id = h.review_id
              WHERE r.flagged AND NOT h.keep_flagged' INTO _n;
    RAISE NOTICE '% review(s) held only for screening stay flagged (hidden); decide them in Moderation (reviews, hidden only)', _n;
  END IF;
END
$held$;
DROP TRIGGER IF EXISTS zz_reviews_hold_for_screening ON public.reviews;
DROP FUNCTION IF EXISTS public.hold_review_for_screening();
DROP POLICY IF EXISTS "Users can write reviews as themselves" ON public.reviews;
CREATE POLICY "Users can write reviews as themselves" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = auth.uid() AND flagged = false);
DROP POLICY IF EXISTS "Reviewees view their private reviews" ON public.reviews;
CREATE POLICY "Reviewees view their private reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (
  is_private = true
  AND reviewee_id = (auth.uid())::text
  AND reviewee_kind NOT IN ('gym', 'team', 'org', 'trainer_org')
);
DROP FUNCTION IF EXISTS public.release_review_screening(uuid, text, text);
DROP FUNCTION IF EXISTS private_sec.review_is_held(uuid);
DROP FUNCTION IF EXISTS private_sec.record_review_hold(uuid, boolean);
DROP TABLE IF EXISTS private_sec.review_screening_holds;
\endif

\if :rb_part4
-- 4. report guard and audit (user_reports)
DROP TRIGGER IF EXISTS zz_user_reports_moderation_guard ON public.user_reports;
DROP FUNCTION IF EXISTS public.guard_report_moderation_update();
DROP FUNCTION IF EXISTS private_sec.audit_report_change(jsonb, jsonb);
\endif

-- postcondition: nothing of the named parts is left
DO $verify$
DECLARE
  _p text := current_setting('app.rollback_20261031120000_parts');
  _left text[] := '{}';
BEGIN
  IF (_p = 'all' OR _p ~ '(^|,)1(,|$)')
     AND (to_regprocedure('public.lock_member_row_identity()') IS NOT NULL
          OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a0_team_members_identity_locked')) THEN
    _left := _left || 'part 1'::text;
  END IF;
  IF (_p = 'all' OR _p ~ '(^|,)2(,|$)')
     AND (to_regprocedure('public.lock_payment_refund_fields()') IS NOT NULL
          OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a00_payment_refund_fields_locked')) THEN
    _left := _left || 'part 2'::text;
  END IF;
  IF (_p = 'all' OR _p ~ '(^|,)3(,|$)')
     AND (to_regprocedure('public.hold_review_for_screening()') IS NOT NULL
          OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'zz_reviews_hold_for_screening')
          OR to_regprocedure('public.release_review_screening(uuid,text,text)') IS NOT NULL
          OR to_regprocedure('private_sec.review_is_held(uuid)') IS NOT NULL
          OR to_regprocedure('private_sec.record_review_hold(uuid,boolean)') IS NOT NULL
          OR to_regclass('private_sec.review_screening_holds') IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reviews'
                           AND policyname = 'Users can write reviews as themselves' AND with_check NOT LIKE '%review_is_held%')
          OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reviews'
                           AND policyname = 'Reviewees view their private reviews' AND qual NOT LIKE '%flagged%')) THEN
    _left := _left || 'part 3'::text;
  END IF;
  IF (_p = 'all' OR _p ~ '(^|,)4(,|$)')
     AND (to_regprocedure('public.guard_report_moderation_update()') IS NOT NULL
          OR to_regprocedure('private_sec.audit_report_change(jsonb,jsonb)') IS NOT NULL
          OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'zz_user_reports_moderation_guard')) THEN
    _left := _left || 'part 4'::text;
  END IF;
  IF cardinality(_left) > 0 THEN
    RAISE EXCEPTION 'rollback of 20261031120000 incomplete: % still present', array_to_string(_left, ', ');
  END IF;
  RAISE NOTICE 'rollback of 20261031120000, parts %: done', _p;
END
$verify$;
