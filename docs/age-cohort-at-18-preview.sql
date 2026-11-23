-- READ-ONLY preview for "age the stored cohort at 18" (docs/age-cohort-at-18.md). COUNTS ONLY: no ids, no names, no
-- emails, no dates of birth. Safe to run against any database, including production, by the owner:
--     psql "$DATABASE_URL" -f agecohort-preview.sql
-- It opens a READ ONLY transaction, so even a mistake cannot write. It does not need the migration: it carries the same
-- rule inline. A person would be moved to 'adult' only if ALL of these hold: stored cohort teen_13_15 or teen_16_17; a stored
-- birthday with age() of 18 or more (the pay RPC's and the guardian rule's computation); age_cohort_from_birthday also says
-- adult (so a changed adult_age policy is honoured); not a managed account; no age review pending.
BEGIN TRANSACTION READ ONLY;

WITH base AS (
  SELECT p.id, p.age_cohort, p.age_review_required,
         pb.birthday,
         (pb.birthday IS NOT NULL AND date_part('year', age(pb.birthday))::int >= 18)                  AS known_adult,
         (pb.birthday IS NOT NULL AND public.age_cohort_from_birthday(pb.birthday) = 'adult')          AS policy_adult,
         EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = p.id)                  AS managed
    FROM public.profiles p
    LEFT JOIN public.profile_birthdays pb ON pb.user_id = p.id
),
due AS (
  SELECT * FROM base
   WHERE age_cohort IN ('teen_13_15', 'teen_16_17') AND known_adult AND policy_adult
     AND NOT managed AND NOT age_review_required
)
SELECT
  (SELECT count(*) FROM due)                                                        AS would_be_aged,
  (SELECT count(*) FROM due WHERE age_cohort = 'teen_13_15')                         AS would_be_aged_from_teen_13_15,
  (SELECT count(*) FROM due WHERE age_cohort = 'teen_16_17')                         AS would_be_aged_from_teen_16_17,
  (SELECT count(*) FROM base WHERE age_cohort IN ('teen_13_15', 'teen_16_17') AND known_adult AND policy_adult AND managed)
                                                                                    AS stale_teen_but_managed_left_alone,
  (SELECT count(*) FROM base WHERE age_cohort IN ('teen_13_15', 'teen_16_17') AND known_adult AND policy_adult
                              AND NOT managed AND age_review_required)               AS stale_teen_age_review_pending_left_alone,
  (SELECT count(*) FROM base WHERE age_cohort = 'child_under_13' AND known_adult AND NOT managed)
                                                                                    AS under_13_cohort_but_known_adult_left_alone,
  (SELECT count(*) FROM base WHERE age_cohort = 'unknown' AND known_adult)           AS unknown_cohort_but_known_adult_left_alone,
  (SELECT count(*) FROM base WHERE age_cohort IN ('teen_13_15', 'teen_16_17') AND NOT known_adult)
                                                                                    AS teens_still_under_18_untouched,
  (SELECT count(*) FROM base WHERE age_cohort IN ('teen_13_15', 'teen_16_17') AND birthday IS NULL)
                                                                                    AS teen_cohort_with_no_birthday_untouched,
  (SELECT count(*) FROM base b
    WHERE b.age_cohort IN ('teen_13_15', 'teen_16_17') AND NOT b.known_adult AND b.birthday IS NOT NULL
      AND date_part('year', age((current_date + 30)::timestamp, b.birthday::timestamp))::int >= 18)
                                                                                    AS turning_18_within_30_days;

-- The people the sweep would move, and what their stored settings look like. Counts only.
WITH due AS (
  SELECT p.id, p.age_cohort
    FROM public.profiles p
    JOIN public.profile_birthdays pb ON pb.user_id = p.id AND pb.birthday IS NOT NULL
   WHERE p.age_cohort IN ('teen_13_15', 'teen_16_17')
     AND NOT p.age_review_required
     AND date_part('year', age(pb.birthday))::int >= 18
     AND public.age_cohort_from_birthday(pb.birthday) = 'adult'
     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = p.id)
)
SELECT
  -- Would read WIDER at the flip if nothing were done: no stored row (the cohort supplies members / follow approval on),
  -- or a stored follow approval of false the minor floor never clamped. The sweep makes the row explicit / puts it right.
  count(*) FILTER (WHERE pp.user_id IS NULL)                                         AS no_stored_privacy_row_would_get_one,
  count(*) FILTER (WHERE pp.user_id IS NOT NULL AND NOT pp.require_follow_approval)  AS stored_follow_approval_off_would_be_put_right,
  -- Already wider than the minor floor TODAY (stored public profile): unchanged by the sweep, reported for the owner.
  count(*) FILTER (WHERE pp.profile_visibility = 'public')                           AS stored_profile_public_already_today,
  count(*) FILTER (WHERE pp.profile_visibility = 'members')                          AS stored_profile_members_kept,
  count(*) FILTER (WHERE pp.profile_visibility = 'private')                          AS stored_profile_private_kept,
  -- Messages: a stale 13-15 whose stored choice is "everyone" becomes "shared" (the shared-game rule it had with adults).
  count(*) FILTER (WHERE d.age_cohort = 'teen_13_15' AND pp.allow_messages = 'everyone') AS stale_13_15_messages_everyone_to_shared,
  -- Content the cohort alone has been hiding: reels become drafts, open availability posts are paused.
  (SELECT count(DISTINCT r.user_id) FROM public.highlight_reels r JOIN due d2 ON d2.id = r.user_id
    WHERE NOT r.is_draft AND r.subject_child_id IS NULL)                              AS people_with_reels_that_would_become_drafts,
  (SELECT count(*) FROM public.highlight_reels r JOIN due d2 ON d2.id = r.user_id
    WHERE NOT r.is_draft AND r.subject_child_id IS NULL)                              AS reels_that_would_become_drafts,
  (SELECT count(DISTINCT a.user_id) FROM public.player_availabilities a JOIN due d2 ON d2.id = a.user_id
    WHERE a.status = 'open' AND a.hidden_at IS NULL)                                  AS people_with_open_availability_posts_that_would_be_paused,
  (SELECT count(*) FROM public.player_availabilities a JOIN due d2 ON d2.id = a.user_id
    WHERE a.status = 'open' AND a.hidden_at IS NULL)                                  AS open_availability_posts_that_would_be_paused,
  -- Held at the flip until the person saves their Privacy settings: their exact age and their roster row (every aged person).
  count(*)                                                                           AS people_whose_age_and_roster_row_would_be_held,
  count(*) FILTER (WHERE pp.profile_visibility IN ('public', 'members'))              AS of_them_with_a_visible_profile,
  (SELECT count(*) FROM public.team_members tm JOIN due d2 ON d2.id = tm.user_id)    AS roster_rows_that_would_be_held,
  -- What other people wrote on their content (games they host, team posts they wrote, their reels) stays closed as it was.
  (SELECT count(*) FROM public.post_comments c
     JOIN due d2 ON d2.id = CASE c.subject_type
            WHEN 'game' THEN (SELECT g.host_id FROM public.hosted_games g WHERE g.id = c.subject_id)
            WHEN 'team_post' THEN (SELECT tp.author_id FROM public.team_posts tp WHERE tp.id::text = c.subject_id)
            WHEN 'highlight_reel' THEN (SELECT r.user_id FROM public.highlight_reels r WHERE r.id::text = c.subject_id) END
    WHERE c.author_id <> d2.id)                                                       AS comments_by_others_that_would_stay_closed,
  -- Families: how many of them still have an active guardian link row (the guardian sweep ends those separately).
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.guardian_links gl WHERE gl.child_user_id = d.id AND gl.status = 'active'))
                                                                                    AS with_an_active_guardian_link_row
FROM due d
LEFT JOIN public.privacy_preferences pp ON pp.user_id = d.id;

ROLLBACK;
