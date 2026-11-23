-- 20261130100000_managed_notice_points_to_handover: the one notice 20261125200000 sends a MANAGING guardian when a managed
-- account's person turns 18 now says the guardian can start the handover, instead of "Contact support to plan handing it
-- over". Only that text changed. Checked in order: the function is the old one with only the string replaced (put the old
-- string back and it has the md5 20261125200000 gave it, and the grants and comment are the old ones), the new text is what
-- is sent (exactly), once per account (the existing once-only rule), only to the managing guardian, only for a managed known
-- adult, and everything else the sweep does is as before (links in force, audit rows, the other notices, the result).
--
-- People: ga and gb (guardians). Managed adults: mgdone (20) and mgdtwo (22), both managed by ga; mgdold (30), managed by gb;
-- mgdsent (25), managed by ga and already told (a stored 'managed_notice' row and a notice with the OLD text, as a sweep
-- before the migration left them). Managed and not told: mgdkid (17, the day-before kind of person), mgdnobday (no birthday).
-- Unmanaged: turned (25, linked to ga: the link ends, as before) and teen (16, linked to ga: untouched).
BEGIN;

SELECT t.person('ga', 41), t.person('gb', 42), t.person('mgdone', 20), t.person('mgdtwo', 22), t.person('mgdold', 30),
       t.person('mgdsent', 25), t.person('mgdkid', 17), t.person('turned', 25), t.person('teen', 16);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('mgdnobday'), 'mgdnobday@example.test', now(), jsonb_build_object('display_name', 'Mgdnobday', 'account_type', 'player'));

SELECT t.guardian('ga', 'mgdone'), t.guardian('ga', 'mgdtwo'), t.guardian('gb', 'mgdold'), t.guardian('ga', 'mgdsent'),
       t.guardian('ga', 'mgdkid'), t.guardian('ga', 'mgdnobday'), t.guardian('ga', 'turned'), t.guardian('ga', 'teen');
INSERT INTO public.managed_accounts (child_user_id, managed_by)
VALUES (t.id('mgdone'), t.id('ga')), (t.id('mgdtwo'), t.id('ga')), (t.id('mgdold'), t.id('gb')),
       (t.id('mgdsent'), t.id('ga')), (t.id('mgdkid'), t.id('ga')), (t.id('mgdnobday'), t.id('ga'));

-- One managing guardian already told before this migration: the stored row and the notice with the old text.
INSERT INTO private_sec.guardian_link_age_events (child_user_id, parent_user_id, kind)
VALUES (t.id('mgdsent'), t.id('ga'), 'managed_notice');
INSERT INTO public.notifications (user_id, type, title, body, link)
VALUES (t.id('ga'), 'guardian_link', 'A managed account has turned 18',
        'Mgdsent is 18 or over. Their account has no sign-in of its own, so it stays linked to you for now. Contact support to plan handing it over.',
        '/parent');

-- ---- 1. the definition: only the string changed ----------------------------------------------------------------------
CREATE TEMP TABLE def AS
  SELECT pg_get_functiondef('private_sec.end_adult_guardian_links(integer)'::regprocedure) AS d;
SELECT t.ok((SELECT position('Contact support to plan handing it over' IN d) = 0 AND position('stays linked to you for now' IN d) = 0 FROM def),
  'the stored definition no longer holds the old text');
SELECT t.eq((SELECT (length(d) - length(replace(d, 'You can start one from your Parent Center: open their page and choose "Start handover".', ''))) /
                    length('You can start one from your Parent Center: open their page and choose "Start handover".') FROM def), 1,
  'and holds the new sentence once');
SELECT t.eq((SELECT md5(replace(d,
        'Their account has no sign-in of its own, so you still manage it until they complete a handover. You can start one from your Parent Center: open their page and choose "Start handover".',
        'Their account has no sign-in of its own, so it stays linked to you for now. Contact support to plan handing it over.')) FROM def),
  '70a31fe4cdd5914cd419528c9cfa4496',
  'put the old string back and the definition is exactly the one 20261125200000 created (its rollback''s md5): only the text changed');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.end_adult_guardian_links(integer)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'private_sec.end_adult_guardian_links(integer)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'private_sec.end_adult_guardian_links(integer)', 'EXECUTE'),
  'still not callable by the API roles');
SELECT t.eq((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = 'private_sec.end_adult_guardian_links(integer)'::regprocedure),
  true, 'still SECURITY DEFINER with an empty search_path');
SELECT t.eq(obj_description('private_sec.end_adult_guardian_links(integer)'::regprocedure, 'pg_proc'),
  'Records status revoked on active guardian links whose child is a known, unmanaged adult (already out of force in every reader), tells both sides once, reports managed accounts that reached 18 (never ends them). Idempotent, capped per run. Scheduler or by hand.',
  'the function comment is as before');

-- ---- 2. before the sweep -----------------------------------------------------------------------------------------------
CREATE TEMP TABLE links_before AS
  SELECT id, parent_user_id, child_user_id, status, verified_at, relationship FROM public.guardian_links;
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE title = 'A managed account has turned 18'), 1,
  'setup: one managed notice exists, the old one');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events), 1, 'setup: one event row');

-- ---- 3. the sweep ------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE sweep1 AS SELECT private_sec.end_adult_guardian_links() AS r;
SELECT t.eq((SELECT (r ->> 'ended')::int FROM sweep1), 1, 'the sweep ends the one unmanaged adult''s link (as before)');
SELECT t.eq((SELECT (r ->> 'notified')::int FROM sweep1), 4, 'and counts four notices: the ended link and three managing guardians told');
SELECT t.eq((SELECT (r ->> 'failed')::int FROM sweep1), 0, 'none failed');
SELECT t.eq((SELECT (r ->> 'remaining')::int FROM sweep1), 0, 'none remain');
SELECT t.eq((SELECT (r ->> 'managed_waiting')::int FROM sweep1), 4, 'four managed adults reported waiting (mgdone, mgdtwo, mgdold, mgdsent)');

-- The text that is sent: exactly this, once per account.
SELECT t.eq((SELECT string_agg(body, ' || ' ORDER BY body) FROM public.notifications WHERE user_id = t.id('ga') AND title = 'A managed account has turned 18' AND body LIKE 'Mgdone %'),
  'Mgdone is 18 or over. Their account has no sign-in of its own, so you still manage it until they complete a handover. You can start one from your Parent Center: open their page and choose "Start handover".',
  'the notice about mgdone says the new text, word for word');
SELECT t.eq((SELECT string_agg(body, ' || ' ORDER BY body) FROM public.notifications WHERE user_id = t.id('ga') AND title = 'A managed account has turned 18' AND body LIKE 'Mgdtwo %'),
  'Mgdtwo is 18 or over. Their account has no sign-in of its own, so you still manage it until they complete a handover. You can start one from your Parent Center: open their page and choose "Start handover".',
  'and the one about mgdtwo');
SELECT t.eq((SELECT string_agg(body, ' || ' ORDER BY body) FROM public.notifications WHERE user_id = t.id('gb') AND title = 'A managed account has turned 18'),
  'Mgdold is 18 or over. Their account has no sign-in of its own, so you still manage it until they complete a handover. You can start one from your Parent Center: open their page and choose "Start handover".',
  'a second managing guardian is told the same way about their own managed account');
SELECT t.eq((SELECT array_agg(DISTINCT type || '|' || title || '|' || link) FROM public.notifications WHERE title = 'A managed account has turned 18'),
  ARRAY['guardian_link|A managed account has turned 18|/parent'],
  'type, title and link are as before');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE title = 'A managed account has turned 18'), 4,
  'four managed notices in all: the old one, and three new');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE body LIKE '%Contact support%' OR body LIKE '%stays linked to you for now%'), 1,
  'the old text is in exactly one row: the notice sent before the migration, which is not rewritten');
SELECT t.eq((SELECT string_agg(body, ' || ' ORDER BY body) FROM public.notifications WHERE body LIKE '%Contact support%'),
  'Mgdsent is 18 or over. Their account has no sign-in of its own, so it stays linked to you for now. Contact support to plan handing it over.',
  'and that row is unchanged');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND body LIKE 'Mgdsent %'), 1,
  'a guardian already told is not told again: still one notice about mgdsent');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.notifications WHERE title = 'A managed account has turned 18'
                         AND body ~* '(legal|law|consent|revoked|withdrawn|restricted|majority|record|delete|erase|keep|retain)'
                         AND body NOT LIKE '%Contact support%'),
  'the new text says nothing about the law, consent, majority or any record');

-- Only the managing guardian, only for a managed known adult.
SELECT t.eq((SELECT array_agg(user_id::text ORDER BY user_id::text) FROM public.notifications WHERE title = 'A managed account has turned 18'),
  (SELECT array_agg(c ORDER BY c) FROM (SELECT t.id('ga')::text c UNION ALL SELECT t.id('ga')::text UNION ALL SELECT t.id('ga')::text UNION ALL SELECT t.id('gb')::text) q),
  'the notices went to the managing guardians only: ga three times (mgdone, mgdtwo, mgdsent), gb once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications
              WHERE user_id IN (t.id('mgdone'), t.id('mgdtwo'), t.id('mgdold'), t.id('mgdsent'), t.id('mgdkid'), t.id('mgdnobday'), t.id('teen'))
                AND type = 'guardian_link'), 0,
  'the managed people themselves and the 16-year-old are told nothing');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('gb') AND type = 'guardian_link'), 1,
  'gb is told only about their own managed account');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND (body LIKE 'Mgdkid %' OR body LIKE 'Mgdnobday %')), 0,
  'a managed 17-year-old and a managed account with no birthday are not reported (not known adults)');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE kind = 'managed_notice'), 4,
  'four managed_notice rows: the pre-seeded one and three new, one per account and guardian');

-- Everything else the sweep did is as before.
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND title = 'Family link ended'), 1, 'the guardian of the unmanaged adult is told once');
SELECT t.eq((SELECT string_agg(body, ' || ' ORDER BY body) FROM public.notifications WHERE user_id = t.id('ga') AND title = 'Family link ended'),
  'Turned is 18 or over, so your family link with them has ended. They no longer appear in your Parent Center.', 'with the same words');
SELECT t.eq((SELECT string_agg(body, ' || ' ORDER BY body) FROM public.notifications WHERE user_id = t.id('turned') AND type = 'guardian_link'),
  'You are 18 or over, so the link to your parent or guardian has ended. They can no longer see or change your account settings.', 'and so is the adult');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'guardian_link'), 6,
  'six guardian_link notices in all: four managed (one old), the ended link''s two');
SELECT t.eq((SELECT array_agg(g.child_user_id::text || ':' || g.status ORDER BY g.child_user_id::text) FROM public.guardian_links g),
  (SELECT array_agg(c ORDER BY c) FROM (
     SELECT t.id(h)::text || ':' || CASE WHEN h = 'turned' THEN 'revoked' ELSE 'active' END c
       FROM unnest(ARRAY['mgdone', 'mgdtwo', 'mgdold', 'mgdsent', 'mgdkid', 'mgdnobday', 'turned', 'teen']) h) q),
  'links: only the unmanaged adult''s was ended; every managed link and the 16-year-old''s are active');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM links_before b JOIN public.guardian_links g USING (id)
                         WHERE b.child_user_id <> t.id('turned')
                           AND (g.status IS DISTINCT FROM b.status OR g.verified_at IS DISTINCT FROM b.verified_at
                             OR g.parent_user_id <> b.parent_user_id OR g.relationship <> b.relationship)),
  'no other link row changed in any column');
SELECT t.eq((SELECT array_agg(DISTINCT action) FROM public.family_audit_log WHERE child_user_id IN (
              t.id('mgdone'), t.id('mgdtwo'), t.id('mgdold'), t.id('mgdsent'), t.id('mgdkid'), t.id('mgdnobday'), t.id('teen'), t.id('turned'))
            AND action = 'link.revoked'),
  ARRAY['link.revoked'], 'the existing audit trigger wrote a link.revoked row');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'link.revoked'), 1, 'exactly one, for the ended link');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'link.revoked' AND child_user_id = t.id('turned')), 1, 'for the unmanaged adult');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE kind = 'ended'), 1, 'one ended row recorded');

-- Once per account: a second and third sweep change nothing.
CREATE TEMP TABLE notices_after_1 AS SELECT id, user_id, title, body FROM public.notifications;
CREATE TEMP TABLE sweep2 AS SELECT private_sec.end_adult_guardian_links() AS r;
SELECT t.eq((SELECT (r ->> 'notified')::int FROM sweep2), 0, 'a second sweep tells nobody');
SELECT t.eq((SELECT (r ->> 'ended')::int FROM sweep2), 0, 'ends nothing');
SELECT t.eq((SELECT (r ->> 'managed_waiting')::int FROM sweep2), 4, 'and still reports the four managed adults waiting');
SELECT t.eq((SELECT count(*)::int FROM public.notifications), (SELECT count(*)::int FROM notices_after_1), 'no new notification row');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE kind = 'managed_notice'), 4, 'and no new managed_notice row');

-- A person who reaches 18 later is told once, with the new text, and a different guardian's account is not mixed up.
-- (the birthday lock is a trigger; a person's 18th birthday simply arrives, so the trigger is stepped around for the one write)
SET LOCAL session_replication_role = replica;
UPDATE public.profile_birthdays SET birthday = (current_date - interval '18 years')::date WHERE user_id = t.id('mgdkid');
SET LOCAL session_replication_role = origin;
CREATE TEMP TABLE sweep3 AS SELECT private_sec.end_adult_guardian_links() AS r;
SELECT t.eq((SELECT (r ->> 'notified')::int FROM sweep3), 1, 'a managed person who turns 18 later: one notice');
SELECT t.eq((SELECT string_agg(body, ' || ' ORDER BY body) FROM public.notifications WHERE user_id = t.id('ga') AND body LIKE 'Mgdkid %'),
  'Mgdkid is 18 or over. Their account has no sign-in of its own, so you still manage it until they complete a handover. You can start one from your Parent Center: open their page and choose "Start handover".',
  'with the new text');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE kind = 'managed_notice' AND child_user_id = t.id('mgdkid')), 1, 'recorded once');
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'notified')::int, 0, 'and not again');
SELECT t.eq(private_sec.guardian_link_in_force(t.id('mgdkid'), 'active'), true,
  'a managed account''s link is still in force at 18: the notice does not end it');

ROLLBACK;
