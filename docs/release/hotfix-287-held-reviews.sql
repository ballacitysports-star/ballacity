-- Read-only count of reviews held for screening by hotfix 20261031120000 (PR #287). Counts only: no row of application
-- data is returned.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-held-reviews.sql
-- held_for_screening: hidden until the server releases them after screening, or a superadmin unhides them
-- (Superadmin, Moderation, reviews, hidden only). Once the #287 app build is published it grows only with reviews the
-- AI screening sends for human review; if it grows with every new review, the release is not working (runbook, D2).
BEGIN READ ONLY;
SET LOCAL search_path = '';
SELECT count(*) FILTER (WHERE r.flagged AND NOT h.keep_flagged) AS held_for_screening,
       count(*) FILTER (WHERE r.flagged AND NOT h.keep_flagged AND h.held_at > now() - interval '1 hour') AS held_in_last_hour,
       count(*) FILTER (WHERE r.flagged AND h.keep_flagged) AS also_flagged_by_integrity_rules
  FROM private_sec.review_screening_holds h
  JOIN public.reviews r ON r.id = h.review_id;
ROLLBACK;
