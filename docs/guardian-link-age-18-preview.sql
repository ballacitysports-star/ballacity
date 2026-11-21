-- READ-ONLY preview for the "guardian links end at 18" change (docs/guardian-link-age-18.md). COUNTS ONLY: no ids, no
-- names, no emails, no dates of birth. Safe to run against any database, including production, by the owner:
--     psql "$DATABASE_URL" -f g18-preview.sql
-- It opens a READ ONLY transaction, so even a mistake cannot write. It does not need the migration (it carries the same
-- rule inline): a stored birthday with age() of 18 or more is a known adult; no birthday is unknown; a managed account
-- (public.managed_accounts) is never ended.
BEGIN TRANSACTION READ ONLY;

WITH active AS (
  SELECT gl.id, gl.parent_user_id, gl.child_user_id,
         EXISTS (SELECT 1 FROM public.profile_birthdays pb
                  WHERE pb.user_id = gl.child_user_id AND pb.birthday IS NOT NULL
                    AND date_part('year', age(pb.birthday))::int >= 18)                       AS known_adult,
         NOT EXISTS (SELECT 1 FROM public.profile_birthdays pb
                      WHERE pb.user_id = gl.child_user_id AND pb.birthday IS NOT NULL)       AS unknown_birthday,
         EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = gl.child_user_id) AS managed
    FROM public.guardian_links gl
   WHERE gl.status = 'active'
)
SELECT
  count(*)                                                               AS active_links,
  count(*) FILTER (WHERE known_adult)                                    AS active_links_child_is_known_adult,
  count(*) FILTER (WHERE known_adult AND NOT managed)                    AS would_end,
  count(DISTINCT child_user_id) FILTER (WHERE known_adult AND NOT managed) AS would_end_distinct_children,
  count(DISTINCT parent_user_id) FILTER (WHERE known_adult AND NOT managed) AS would_end_distinct_guardians,
  count(*) FILTER (WHERE known_adult AND managed)                        AS known_adult_but_managed_would_stay,
  count(*) FILTER (WHERE unknown_birthday)                               AS active_links_unknown_birthday_would_stay,
  count(*) FILTER (WHERE NOT known_adult AND NOT unknown_birthday)       AS active_links_under_18_would_stay,
  count(*) FILTER (WHERE NOT known_adult AND NOT unknown_birthday
                     AND EXISTS (SELECT 1 FROM public.profile_birthdays pb
                                  WHERE pb.user_id = child_user_id
                                    AND date_part('year', age((current_date + 30)::timestamp, pb.birthday::timestamp))::int >= 18)) AS under_18_turning_18_within_30_days
FROM active;

-- Side effects of ending, still counts only.
SELECT
  (SELECT count(*) FROM public.guardian_links gl
    WHERE gl.status = 'active'
      AND EXISTS (SELECT 1 FROM public.profile_birthdays pb WHERE pb.user_id = gl.child_user_id AND pb.birthday IS NOT NULL
                   AND date_part('year', age(pb.birthday))::int >= 18)
      AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = gl.child_user_id)
      AND EXISTS (SELECT 1 FROM public.parental_consents pc WHERE pc.child_user_id = gl.child_user_id))  AS would_end_with_a_consent_record_kept,
  (SELECT count(*) FROM public.join_requests jr
    WHERE jr.guardian_approved_by IS NOT NULL AND jr.status IN ('pending', 'approved')
      AND EXISTS (SELECT 1 FROM public.guardian_links gl
                   WHERE gl.status = 'active' AND gl.child_user_id = jr.player_id AND gl.parent_user_id = jr.guardian_approved_by
                     AND EXISTS (SELECT 1 FROM public.profile_birthdays pb WHERE pb.user_id = gl.child_user_id AND pb.birthday IS NOT NULL
                                  AND date_part('year', age(pb.birthday))::int >= 18)
                     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = gl.child_user_id))) AS open_requests_whose_guardian_approval_would_be_cleared,
  (SELECT count(*) FROM public.guardian_links gl
    JOIN public.profiles p ON p.id = gl.child_user_id
   WHERE gl.status = 'active' AND p.age_cohort <> 'adult'
     AND EXISTS (SELECT 1 FROM public.profile_birthdays pb WHERE pb.user_id = gl.child_user_id AND pb.birthday IS NOT NULL
                  AND date_part('year', age(pb.birthday))::int >= 18)
     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = gl.child_user_id)) AS would_end_where_stored_age_cohort_is_not_adult;

ROLLBACK;
