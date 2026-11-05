-- Hotfix 20261031120000: four write paths live in production are closed (audit 2026-11-04 A-F1/A-F2, B-F1, B-F3, B-F4).
BEGIN;
SELECT t.person('mgr', 38), t.person('adultx', 30), t.person('kid', 14), t.person('teammate', 29),
       t.person('orgowner', 40), t.person('coachx', 33), t.person('host', 35), t.person('payer', 30),
       t.person('author', 31), t.person('subject', 32), t.person('modone', 36), t.person('reporter', 27);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'admin');

-- ============================================================ A-F1: roster rows cannot be re-pointed at someone else
SELECT t.team('qteam', 'mgr');
SELECT t.member('qteam', 'teammate');
SELECT t.team('other', 'adultx');
SELECT t.as_user(t.id('mgr'));
SELECT t.throws(format('UPDATE public.team_members SET user_id = %L WHERE team_id = ''qteam'' AND user_id = %L', t.id('kid'), t.id('teammate')),
  'MEMBER_IDENTITY_FIXED', 'A-F1: a manager cannot re-point a roster row at a minor');
SELECT t.throws(format('UPDATE public.team_members SET user_id = %L WHERE team_id = ''qteam'' AND user_id = %L', t.id('adultx'), t.id('teammate')),
  'MEMBER_IDENTITY_FIXED', 'A-F1: nor at any other person');
SELECT t.throws(format('UPDATE public.team_members SET team_id = ''other'' WHERE team_id = ''qteam'' AND user_id = %L', t.id('teammate')),
  'MEMBER_IDENTITY_FIXED', 'A-F1: nor move it to another team');
SELECT t.lives(format('UPDATE public.team_members SET jersey_number = 7, position = ''guard'' WHERE team_id = ''qteam'' AND user_id = %L', t.id('teammate')),
  'A-F1: the manager still edits jersey number and position');
SELECT t.reset();
SELECT t.ok(NOT public.shares_team(t.id('mgr'), t.id('kid')), 'A-F1: the manager does not share a team with the minor');
SELECT t.eq((SELECT jersey_number::int FROM public.team_members WHERE team_id = 'qteam' AND user_id = t.id('teammate')), 7, 'A-F1: the edit landed');

-- ============================================================ B-F1: refund fields are not the player's to write
INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('pay-q', t.id('host'), 'basketball', 'Paid run', now() + interval '2 days');
SELECT t.as_user(t.id('payer'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, refund_status, refund_amount, refund_pct, refund_reason)
                          VALUES (%L, 'pay-q', %L, 'venmo', 'owed', 4999, 100, 'game_cancelled')$q$, t.id('payer'), t.id('host')),
  'PAYMENT_FIELD_FORBIDDEN', 'B-F1: a player cannot file a claim that says a refund is owed');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id, payment_type) VALUES (%L, %L, 'pay-q', %L, 'venmo')$q$,
                      t.id('claimq'), t.id('payer'), t.id('host')),
  'B-F1: an ordinary claim still works');
SELECT t.throws(format('UPDATE public.payment_submissions SET refund_amount = 9999 WHERE id = %L', t.id('claimq')),
  'PAYMENT_FIELD_FORBIDDEN', 'B-F1: nor set a refund amount on a pending claim');
SELECT t.throws(format('UPDATE public.payment_submissions SET refund_status = ''owed'' WHERE id = %L', t.id('claimq')),
  'PAYMENT_FIELD_FORBIDDEN', 'B-F1: nor a refund status');
SELECT t.lives(format('UPDATE public.payment_submissions SET notes = ''sent it'' WHERE id = %L', t.id('claimq')),
  'B-F1: the player still edits their pending claim');
SELECT t.reset();
SELECT t.as_service();
SELECT t.lives(format('UPDATE public.payment_submissions SET refund_status = ''owed'', refund_amount = 10 WHERE id = %L', t.id('claimq')),
  'B-F1: the service role (refund engine) still writes refund fields');
SELECT t.reset();

-- ============================================================ B-F3: reviews written through the API are held until screened
-- a past game both played in, so the author may review the subject
INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('rev-q', t.id('subject'), 'basketball', 'Past run', now() - interval '1 day');
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('rev-q', t.id('author'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('author'));
SELECT t.lives(format($q$INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
                         VALUES (%L, %L, 'player', 'host', %L, 'Subject', 1, 'UNSCREENED text inserted directly')$q$,
                      t.id('rq'), t.id('author'), t.id('subject')::text),
  'B-F3 setup: an eligible author inserts a review directly');
SELECT t.reset();
SELECT t.ok((SELECT flagged FROM public.reviews WHERE id = t.id('rq')), 'B-F3: a direct insert is held (flagged), not public');
SELECT t.as_anon();
SELECT t.eq((SELECT count(*)::int FROM public.reviews WHERE id = t.id('rq')), 0, 'B-F3: anonymous readers do not see it');
SELECT t.reset();
SELECT t.as_user(t.id('author'));
SELECT t.throws(format('SELECT public.release_review_screening(%L)', t.id('rq')), 'permission denied', 'B-F3: the author cannot release their own hold');
SELECT t.reset();
SELECT t.as_service();
SELECT t.eq(public.release_review_screening(t.id('rq')), true, 'B-F3: the server releases it after screening');
SELECT t.reset();
SELECT t.ok(NOT (SELECT flagged FROM public.reviews WHERE id = t.id('rq')), 'B-F3: and it is visible');
SELECT t.as_user(t.id('author'));
SELECT t.lives(format('UPDATE public.reviews SET body = ''EDITED after screening, never checked'' WHERE id = %L', t.id('rq')),
  'B-F3 setup: the author edits the text afterwards');
SELECT t.reset();
SELECT t.ok((SELECT flagged FROM public.reviews WHERE id = t.id('rq')), 'B-F3: an edit hides the review until screened again');
-- a review the integrity rules flagged stays flagged after the screening release
SELECT t.as_service();
SELECT public.release_review_screening(t.id('rq'));
SELECT t.reset();
UPDATE public.reviews SET flagged = true WHERE id = t.id('rq');                 -- e.g. reported and held by a moderator
SELECT t.as_user(t.id('author'));
SELECT t.lives(format('UPDATE public.reviews SET body = ''Another edit of the text'' WHERE id = %L', t.id('rq')), 'B-F3 setup: edit a flagged review');
SELECT t.reset();
SELECT t.as_service();
SELECT t.eq(public.release_review_screening(t.id('rq')), false, 'B-F3: releasing the screening hold does not clear an earlier flag');
SELECT t.reset();
SELECT t.ok((SELECT flagged FROM public.reviews WHERE id = t.id('rq')), 'B-F3: the earlier flag stands');

-- gym reviews keep their direct path (they are not AI-screened) and are not held
SELECT t.as_user(t.id('orgowner'));
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('somegym'), t.id('orgowner'), 'Gym', 'gymq');
SELECT t.reset();
SELECT t.as_user(t.id('author'));
SELECT t.lives(format($q$INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
                         VALUES (%L, %L, 'player', 'gym', %L, 'Gym', 4, 'Clean courts and friendly staff')$q$,
                      t.id('gymrev'), t.id('author'), t.id('somegym')::text),
  'B-F3: a gym review still posts directly');
SELECT t.reset();
SELECT t.ok(NOT (SELECT flagged FROM public.reviews WHERE id = t.id('gymrev')), 'B-F3: and is not held');

-- ============================================================ B-F4: direct report changes are limited, attributed and audited
SELECT t.as_user(t.id('reporter'));
SELECT t.lives(format($q$INSERT INTO public.user_reports (id, reporter_id, reported_id, reason, details) VALUES (%L, %L, %L, 'harassment', 'original')$q$,
                      t.id('rep'), t.id('reporter'), t.id('subject')), 'B-F4 setup: a report is filed');
SELECT t.reset();
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$UPDATE public.user_reports SET details = 'rewritten' WHERE id = %L$q$, t.id('rep')),
  'REPORT_FIELDS_FIXED', 'B-F4: a moderator cannot rewrite what was reported');
SELECT t.throws(format($q$UPDATE public.user_reports SET reporter_id = %L WHERE id = %L$q$, t.id('modone'), t.id('rep')),
  'REPORT_FIELDS_FIXED', 'B-F4: nor who reported it');
SELECT t.lives(format($q$UPDATE public.user_reports SET status = 'dismissed', reviewed_by = %L, resolution_notes = 'n/a' WHERE id = %L$q$,
                      t.id('reporter'), t.id('rep')), 'B-F4: a moderator can still decide a report directly');
SELECT t.reset();
SELECT t.eq((SELECT reviewed_by FROM public.user_reports WHERE id = t.id('rep')), t.id('modone'),
  'B-F4: reviewed_by is the moderator who acted, not the name they supplied');
SELECT t.eq((SELECT details FROM public.user_reports WHERE id = t.id('rep')), 'original', 'B-F4: the report text is unchanged');
SELECT t.eq((SELECT count(*)::int FROM public.admin_audit_log WHERE target_type = 'user_report' AND target_id = t.id('rep')::text
              AND actor_id = t.id('modone') AND action = 'report_updated_directly'), 1, 'B-F4: and the change is audited');
ROLLBACK;
