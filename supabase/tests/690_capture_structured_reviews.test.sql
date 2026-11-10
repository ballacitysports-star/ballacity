-- Captures of production-only schema (20261103110000_capture_structured_reviews, 20261108090000_capture_messages_check_order).
-- It pins the replayed objects to production's exact definitions, taken read-only on 2026-11-07 with the catalog
-- fingerprint's normalization (comments and whitespace removed), so a replay of main builds what production has:
--   * the structured-review columns, constraint and four functions;
--   * the messages body/attachment check in production's order;
--   * both checks are enforced (validated), not merely declared.
BEGIN;

-- ---- columns and constraint ----------------------------------------------------------------
SELECT t.eq((SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' ORDER BY column_name)
               FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name IN ('answers', 'recommend', 'tags')),
  'answers:jsonb:NO:''{}''::jsonb,recommend:text:YES:,tags:ARRAY:NO:''{}''::text[]',
  'reviews has production''s answers, recommend and tags columns');
SELECT t.eq((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'reviews_recommend_check'),
  'CHECK (((recommend IS NULL) OR (recommend = ANY (ARRAY[''yes''::text, ''not_sure''::text, ''no''::text]))))',
  'reviews_recommend_check is production''s');
SELECT t.eq((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'messages_body_or_attachment_chk'),
  'CHECK (((deleted_at IS NOT NULL) OR ((body IS NOT NULL) AND (length(btrim(body)) > 0)) OR (attachment_path IS NOT NULL)))',
  'messages_body_or_attachment_chk has production''s order');

-- ---- functions: identical to production -------------------------------------------------------
CREATE TEMP VIEW fn_hash AS
  SELECT p.oid::regprocedure::text AS fn,
         md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS h
    FROM pg_proc p
   WHERE p.proname IN ('enforce_review_integrity', 'player_trait_counts', 'review_question_keys', 'review_tag_keys');
-- PRIV-1 (20261108100000_minor_review_privacy) deliberately redefines these two, building on the captured versions.
-- Until PRIV-1 is applied there, production keeps the captured ones: enforce_review_integrity f947c41b1861a79f9055767070bbcc14,
-- player_trait_counts 939f6254eb2516ab01b1f4f3fb354061.
SELECT t.eq((SELECT h FROM fn_hash WHERE fn = 'enforce_review_integrity()'), '200bf368b5cdd8e9763e3555d4756dfd',
  'enforce_review_integrity is the captured version as PRIV-1 extends it');
SELECT t.eq((SELECT h FROM fn_hash WHERE fn = 'player_trait_counts(uuid)'), '8aca32746b2b12a62bd47a949edde559',
  'player_trait_counts is the captured version as PRIV-1 extends it');
SELECT t.eq((SELECT h FROM fn_hash WHERE fn = 'review_question_keys(text)'), '7be31278957db98b5c477d25b279e9c9',
  'review_question_keys is production''s');
SELECT t.eq((SELECT h FROM fn_hash WHERE fn = 'review_tag_keys(text)'), '4627f1e129b4aa158d5d65d46a6c3d56',
  'review_tag_keys is production''s');

-- ---- behaviour ------------------------------------------------------------------------------------
SELECT t.ok(cardinality(public.review_question_keys('player')) > 0 OR public.review_question_keys('player') IS NOT NULL,
  'the question keys helper answers');
SELECT t.eq((SELECT bool_and(convalidated) FROM pg_constraint
              WHERE conname IN ('reviews_recommend_check', 'messages_body_or_attachment_chk')), true,
  'both checks are validated against existing rows');

ROLLBACK;
