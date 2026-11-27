-- P1-2a: a member reports a network post (supabase/migrations/20261205100000_network_post_reports.sql).
--   * report_post answers POST_NOT_FOUND, word for word and code for code, for a post that does not exist and for every
--     post the caller cannot read (audience, block either way, moderation, hidden, deleted, hidden team): no oracle;
--   * a reader of the post reports it once while that report is open; the report names the author (for a team or
--     facility post, the person who wrote it), never the caller; nobody reports their own post; signed-out visitors
--     cannot call it; the reason is one user_reports_reason_check allows, checked before the post is looked up;
--   * the author never reads the report; members cannot write a post report into the table directly;
--   * the subject check keeps every subject it had and adds 'post'; post_id follows the post (ON DELETE SET NULL);
--   * EXECUTE for authenticated only. The concurrent case (two calls at once) is the race in scripts/db-test.mjs.
BEGIN;

SELECT t.person('writer', 30), t.person('onlooker', 28), t.person('fan', 27), t.person('teammate', 26),
       t.person('kinteen', 15), t.person('blocker', 31), t.person('blockee', 32), t.person('clubowner', 45),
       t.person('coach', 40), t.person('gymowner', 50), t.person('modone', 35), t.person('other', 29),
       t.person('nobody', 33);
SELECT t.guardian('writer', 'kinteen');
SELECT t.team('pr-team', 'clubowner');
SELECT t.member('pr-team', 'writer');
SELECT t.member('pr-team', 'teammate');
SELECT t.member('pr-team', 'coach', 'manager');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('gym'), t.id('gymowner'), 'Report Gym', 'report-gym');
INSERT INTO public.follows (follower_id, followee_id) VALUES (t.id('fan'), t.id('writer'));
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blocker'), t.id('writer')), (t.id('writer'), t.id('blockee'));
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator');

-- Written as server code would leave them (auth.uid() is NULL here, so the moderation status is kept as given).
INSERT INTO public.posts (id, author_id, posted_as, team_id, org_id, audience, body, moderation_status, hidden_at, deleted_at) VALUES
  (t.id('pp-public'),    t.id('writer'),   'person', NULL,      NULL,      'public',    'Open run Saturday', 'approved', NULL, NULL),
  (t.id('pp-followers'), t.id('writer'),   'person', NULL,      NULL,      'followers', 'Training diary',    'approved', NULL, NULL),
  (t.id('pp-team'),      t.id('writer'),   'person', 'pr-team', NULL,      'team',      'See you at 6',      'approved', NULL, NULL),
  (t.id('pp-family'),    t.id('writer'),   'person', NULL,      NULL,      'family',    'Home by 9',         'approved', NULL, NULL),
  (t.id('pp-pending'),   t.id('writer'),   'person', NULL,      NULL,      'public',    'Not checked yet',   'pending',  NULL, NULL),
  (t.id('pp-held'),      t.id('writer'),   'person', NULL,      NULL,      'public',    'Held by the screen', 'held',    NULL, NULL),
  (t.id('pp-hidden'),    t.id('writer'),   'person', NULL,      NULL,      'public',    'Hidden by staff',   'approved', now(), NULL),
  (t.id('pp-deleted'),   t.id('writer'),   'person', NULL,      NULL,      'public',    'Deleted by me',     'approved', NULL, now()),
  (t.id('pp-as-team'),   t.id('coach'),    'team',   'pr-team', NULL,      'public',    'Tryouts Sunday',    'approved', NULL, NULL),
  (t.id('pp-as-gym'),    t.id('gymowner'), 'org',    NULL,      t.id('gym'), 'public',  'Courts resurfaced', 'approved', NULL, NULL);

-- The error a statement raises, as SQLSTATE and message; NULL when it succeeds.
CREATE FUNCTION t.err565(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
CREATE FUNCTION t.report565(_post text, _reason text DEFAULT 'spam', _details text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$ SELECT t.err565(format('SELECT public.report_post(%L, %L, %L)', t.id(_post), _reason, _details)) $$;
-- The reasons user_reports_reason_check allows, read from the constraint itself.
CREATE FUNCTION t.reasons565() RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(m[1] ORDER BY m[1])
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   WHERE c.conrelid = 'public.user_reports'::regclass AND c.conname = 'user_reports_reason_check' $$;
CREATE FUNCTION t.rows565(_post text, _reporter text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.user_reports WHERE post_id = t.id(_post) AND reporter_id = t.id(_reporter) $$;

-- ---- no oracle: a missing post and a post the caller cannot read get one answer ---------------------------------------
SELECT t.as_user(t.id('onlooker'));
SELECT t.eq(t.report565('pp-missing'), 'P0002 POST_NOT_FOUND', 'a post that does not exist: POST_NOT_FOUND');
SELECT t.eq(t.report565('pp-followers'), t.report565('pp-missing'), 'a stranger and a followers post: the same answer as a missing post');
SELECT t.eq(t.report565('pp-team'), t.report565('pp-missing'), 'a stranger and a team post: the same answer');
SELECT t.eq(t.report565('pp-family'), t.report565('pp-missing'), 'a stranger and a family post: the same answer');
SELECT t.eq(t.report565('pp-pending'), t.report565('pp-missing'), 'a post still waiting for its check: the same answer');
SELECT t.eq(t.report565('pp-held'), t.report565('pp-missing'), 'a post the screen held: the same answer');
SELECT t.eq(t.report565('pp-hidden'), t.report565('pp-missing'), 'a post staff hid: the same answer');
SELECT t.eq(t.report565('pp-deleted'), t.report565('pp-missing'), 'a deleted post: the same answer');
SELECT t.eq(t.err565('SELECT public.report_post(NULL, ''spam'')'), t.report565('pp-missing'), 'no post id: the same answer');
SELECT t.as_user(t.id('blocker'));
SELECT t.eq(t.report565('pp-public'), t.report565('pp-missing'), 'someone who blocked the author: the same answer, even for a public post');
SELECT t.as_user(t.id('blockee'));
SELECT t.eq(t.report565('pp-public'), t.report565('pp-missing'), 'someone the author blocked: the same answer');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.user_reports), 0, 'and none of those calls wrote a report');

-- ---- a reader reports what they can read ---------------------------------------------------------------------------------
SELECT t.as_user(t.id('onlooker'));
SELECT t.eq(t.report565('pp-public', 'spam', '   first look   '), NULL, 'a member reports a public post they can read');
SELECT t.as_user(t.id('fan'));
SELECT t.eq(t.report565('pp-followers', 'harassment'), NULL, 'a follower reports a followers post');
SELECT t.as_user(t.id('teammate'));
SELECT t.eq(t.report565('pp-team', 'threats'), NULL, 'a teammate reports a team post');
SELECT t.as_user(t.id('kinteen'));
SELECT t.eq(t.report565('pp-family', 'inappropriate'), NULL, 'family reports a family post');
SELECT t.reset();

SELECT t.eq((SELECT reporter_id::text || '|' || reported_id::text || '|' || subject_type || '|' || status || '|' || reason || '|' || coalesce(details, '<none>')
               FROM public.user_reports WHERE post_id = t.id('pp-public')),
            t.id('onlooker')::text || '|' || t.id('writer')::text || '|post|new|spam|first look',
            'the report: the caller reports the post''s author, subject post, status new, details trimmed');
SELECT t.eq((SELECT string_agg(reported_id::text, ',' ORDER BY reported_id) FROM public.user_reports
              WHERE post_id IN (t.id('pp-followers'), t.id('pp-team'), t.id('pp-family'))),
            (SELECT string_agg(x::text, ',' ORDER BY x) FROM (VALUES (t.id('writer')), (t.id('writer')), (t.id('writer'))) v(x)),
            'every one of them names the author');

-- A post made as a team or facility names the person who wrote it, not the team's or facility's owner.
SELECT t.as_user(t.id('onlooker'));
SELECT t.eq(t.report565('pp-as-team', 'misleading'), NULL, 'a member reports a post a team made');
SELECT t.eq(t.report565('pp-as-gym', 'scam'), NULL, 'and one a facility made');
SELECT t.reset();
SELECT t.eq((SELECT reported_id FROM public.user_reports WHERE post_id = t.id('pp-as-team')), t.id('coach'),
  'a team post: the manager who wrote it is the reported user, not the team''s owner');
SELECT t.eq((SELECT reported_id FROM public.user_reports WHERE post_id = t.id('pp-as-gym')), t.id('gymowner'),
  'a facility post: the person who wrote it');

-- Details: blank is none, long is cut to 1000 characters.
SELECT t.as_user(t.id('fan'));
SELECT t.eq(t.report565('pp-as-gym', 'spam', '    '), NULL, 'a report with blank details');
SELECT t.as_user(t.id('teammate'));
SELECT t.eq(t.report565('pp-as-gym', 'spam', repeat('x', 1500)), NULL, 'a report with long details');
SELECT t.reset();
SELECT t.eq((SELECT details FROM public.user_reports WHERE post_id = t.id('pp-as-gym') AND reporter_id = t.id('fan')), NULL,
  'blank details are stored as none');
SELECT t.eq((SELECT length(details) FROM public.user_reports WHERE post_id = t.id('pp-as-gym') AND reporter_id = t.id('teammate')), 1000,
  'long details are cut to 1000 characters');

-- ---- one open report per reporter and post ---------------------------------------------------------------------------------
SELECT t.as_user(t.id('onlooker'));
SELECT t.ok(public.report_post(t.id('pp-public'), 'harassment', 'again')
            = (SELECT r.id FROM public.user_reports r WHERE r.reporter_id = auth.uid() AND r.post_id = t.id('pp-public') LIMIT 1),
  'reporting the same post again answers with the open report');
SELECT t.reset();
SELECT t.eq(t.rows565('pp-public', 'onlooker'), 1, 'and writes no second row');
SELECT t.eq((SELECT string_agg(reason || '|' || coalesce(details, '<none>'), ',' ORDER BY reason) FROM public.user_reports
              WHERE post_id = t.id('pp-public')), 'spam|first look', 'nor changes the first one');

UPDATE public.user_reports SET status = 'resolved' WHERE post_id = t.id('pp-public') AND reporter_id = t.id('onlooker');
SELECT t.as_user(t.id('onlooker'));
SELECT t.eq(t.report565('pp-public'), NULL, 'once a moderator resolves it, the member can report the post again');
SELECT t.reset();
SELECT t.eq(t.rows565('pp-public', 'onlooker'), 2, 'as a new report');
UPDATE public.user_reports SET status = 'escalated' WHERE post_id = t.id('pp-public') AND reporter_id = t.id('onlooker') AND status = 'new';
SELECT t.as_user(t.id('onlooker')); SELECT t.report565('pp-public'); SELECT t.reset();
SELECT t.eq(t.rows565('pp-public', 'onlooker'), 2, 'an escalated report is still open: no new row');
UPDATE public.user_reports SET status = 'actioned' WHERE post_id = t.id('pp-public') AND reporter_id = t.id('onlooker') AND status = 'escalated';
SELECT t.as_user(t.id('onlooker')); SELECT t.report565('pp-public'); SELECT t.reset();
SELECT t.eq(t.rows565('pp-public', 'onlooker'), 3, 'an actioned report is closed: a new row');
UPDATE public.user_reports SET status = 'investigating' WHERE post_id = t.id('pp-public') AND reporter_id = t.id('onlooker') AND status = 'new';
SELECT t.as_user(t.id('onlooker')); SELECT t.report565('pp-public'); SELECT t.reset();
SELECT t.eq(t.rows565('pp-public', 'onlooker'), 3, 'an investigating report is still open: no new row');
UPDATE public.user_reports SET status = 'dismissed' WHERE post_id = t.id('pp-public') AND reporter_id = t.id('onlooker') AND status = 'investigating';
SELECT t.as_user(t.id('onlooker')); SELECT t.report565('pp-public'); SELECT t.reset();
SELECT t.eq(t.rows565('pp-public', 'onlooker'), 4, 'a dismissed report is closed: a new row');
SELECT t.as_user(t.id('fan'));
SELECT t.eq(t.report565('pp-public'), NULL, 'someone else reporting the same post');
SELECT t.reset();
SELECT t.eq(t.rows565('pp-public', 'fan'), 1, 'files their own report');

-- ---- nobody reports their own post ---------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('writer'));
SELECT t.eq(t.report565('pp-public'), '22023 CANNOT_REPORT_SELF: you cannot report your own post.', 'the author cannot report their own post');
SELECT t.eq(t.report565('pp-pending'), '22023 CANNOT_REPORT_SELF: you cannot report your own post.', 'nor their own post that is still being checked');
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.report565('pp-as-team'), '22023 CANNOT_REPORT_SELF: you cannot report your own post.', 'nor a post they made as a team');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.user_reports WHERE reporter_id IN (t.id('writer'), t.id('coach'))), 0, 'no report written');

-- ---- reasons ---------------------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('onlooker'));
SELECT t.eq(t.report565('pp-public', 'not_a_reason'), '22023 INVALID_REASON', 'a reason outside the list is refused');
SELECT t.eq(t.report565('pp-public', NULL), '22023 INVALID_REASON', 'and no reason at all');
SELECT t.eq(t.report565('pp-followers', 'not_a_reason'), '22023 INVALID_REASON', 'a bad reason is refused before the post is looked up (an unreadable post)');
SELECT t.eq(t.report565('pp-missing', 'not_a_reason'), '22023 INVALID_REASON', 'and a missing post: the same answer');
SELECT t.eq(cardinality(t.reasons565()), 20, 'user_reports_reason_check allows 20 reasons');
SELECT t.eq((SELECT count(*)::int FROM unnest(t.reasons565()) r WHERE t.report565('pp-public', r) IS NOT NULL), 0,
  'report_post takes every reason user_reports_reason_check allows');
SELECT t.reset();

-- ---- who reads a report ----------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('writer'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_reports WHERE reported_id = auth.uid()'), 0, 'the author reads no report about them');
SELECT t.eq(t.count(format('SELECT 1 FROM public.user_reports WHERE post_id IN (%L, %L)', t.id('pp-public'), t.id('pp-family'))), 0,
  'nor any report about their posts');
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_reports'), 0, 'nor does the manager who wrote a team post');
SELECT t.as_user(t.id('onlooker'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_reports'), t.count('SELECT 1 FROM public.user_reports WHERE reporter_id = auth.uid()'),
  'a reporter reads only their own reports');
SELECT t.eq(t.count('SELECT 1 FROM public.user_reports'), 6, 'all six of them');
SELECT t.as_user(t.id('nobody'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_reports'), 0, 'anyone else reads none');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_reports WHERE subject_type = ''post'''), 12, 'a moderator reads every post report');
SELECT t.eq(t.changed(format('UPDATE public.user_reports SET status = ''investigating'' WHERE post_id = %L', t.id('pp-family'))), 1,
  'and can take one up');
SELECT t.throws(format('UPDATE public.user_reports SET post_id = NULL WHERE post_id = %L', t.id('pp-family')), 'REPORT_FIELDS_FIXED',
  'but cannot change which post it is about');
SELECT t.reset();

-- ---- post reports only through report_post ---------------------------------------------------------------------------------------
SELECT t.as_user(t.id('onlooker'));
SELECT t.throws(format($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, post_id) VALUES (auth.uid(), %L, 'spam', 'post', %L)$$,
                       t.id('writer'), t.id('pp-followers')),
  'REPORT_POST_VIA_RPC', 'a member cannot insert a post report directly (here about a post they cannot read)');
SELECT t.throws(format($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, post_id) VALUES (auth.uid(), %L, 'spam', 'user', %L)$$,
                       t.id('nobody'), t.id('pp-public')),
  'REPORT_POST_VIA_RPC', 'nor tie another kind of report to a post');
SELECT t.throws(format($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type) VALUES (auth.uid(), %L, 'spam', 'post')$$,
                       t.id('nobody')),
  'REPORT_POST_VIA_RPC', 'nor file a post report with no post');
SELECT t.eq(t.err565(format($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, post_id) VALUES (auth.uid(), %L, 'spam', 'user', %L)$$,
                            t.id('nobody'), t.id('pp-missing'))),
            t.err565(format($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, post_id) VALUES (auth.uid(), %L, 'spam', 'user', %L)$$,
                            t.id('nobody'), t.id('pp-public'))),
  'a direct insert naming a missing post is refused the same way: the foreign key tells nothing');
SELECT t.lives(format($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, status) VALUES (auth.uid(), %L, 'spam', 'user', 'new')$$,
                      t.id('nobody')),
  'a member still reports a person directly, as the app does');
SELECT t.as_service();
SELECT t.lives(format($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, post_id) VALUES (%L, %L, 'spam', 'post', %L)$$,
                      t.id('nobody'), t.id('writer'), t.id('pp-public')),
  'server code (the service role) can still write one');
SELECT t.reset();

-- ---- signed out, or no user -------------------------------------------------------------------------------------------------------
SELECT t.as_anon();
SELECT t.throws(format('SELECT public.report_post(%L, %L)', t.id('pp-public'), 'spam'), 'permission denied',
  'a signed-out visitor cannot call report_post');
SELECT t.reset();
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT t.eq(t.report565('pp-public'), '42501 AUTH_REQUIRED', 'a call with no signed-in user is refused');
SELECT t.reset();

-- ---- a hidden team hides its posts from reports too ---------------------------------------------------------------------------------
UPDATE public.teams SET hidden_at = now() WHERE id = 'pr-team';
SELECT t.as_user(t.id('fan'));
SELECT t.eq(t.report565('pp-as-team'), t.report565('pp-missing'), 'a post by a hidden team: the same answer as a missing post');
SELECT t.reset();

-- ---- post_id follows the post --------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('writer'));
SELECT t.eq(t.changed(format('DELETE FROM public.posts WHERE id = %L', t.id('pp-followers'))), 1,
  'the author can still delete a reported post for good');
SELECT t.reset();
SELECT t.eq((SELECT subject_type || '|' || coalesce(post_id::text, '<none>') FROM public.user_reports
              WHERE reporter_id = t.id('fan') AND reason = 'harassment'),
  'post|<none>', 'the report stays, without the link');

-- ---- the schema -------------------------------------------------------------------------------------------------------------------------
SELECT t.eq((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.user_reports'::regclass AND conname = 'user_reports_subject_type_check'),
  'CHECK ((subject_type = ANY (ARRAY[''user''::text, ''game''::text, ''message''::text, ''reel''::text, ''payment''::text, ''team_chat_message''::text, ''post''::text])))',
  'the subject check: every subject it had, plus post');
SELECT t.lives($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type)
                 SELECT t.id('other'), t.id('nobody'), 'spam', s
                   FROM unnest(ARRAY['user', 'game', 'message', 'reel', 'payment', 'team_chat_message', 'post']) s$$,
  'every subject it took before is still taken, and post');
SELECT t.throws($$INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type) VALUES (t.id('other'), t.id('nobody'), 'spam', 'comment')$$,
  'user_reports_subject_type_check', 'any other subject is still refused');
SELECT t.eq((SELECT format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text FROM pg_attribute a
              WHERE a.attrelid = 'public.user_reports'::regclass AND a.attname = 'post_id' AND NOT a.attisdropped),
  'uuid|false', 'post_id is a nullable uuid');
SELECT t.eq((SELECT c.confrelid::regclass::text || '|' || c.confdeltype::text FROM pg_constraint c
              WHERE c.conrelid = 'public.user_reports'::regclass AND c.contype = 'f'
                AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.user_reports'::regclass AND attname = 'post_id')]),
  'posts|n', 'it references posts, ON DELETE SET NULL');
SELECT t.eq((SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
               LEFT JOIN pg_roles r ON r.oid = x.grantee
              WHERE p.oid = 'public.report_post(uuid, text, text)'::regprocedure
                AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated:EXECUTE', 'report_post: EXECUTE for authenticated only (not PUBLIC, anon or service_role)');
SELECT t.eq((SELECT p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || (p.proowner = q.proowner)::text
               FROM pg_proc p, pg_proc q
              WHERE p.oid = 'public.report_post(uuid, text, text)'::regprocedure
                AND q.oid = 'public.report_team_chat_message(uuid, text, text)'::regprocedure),
  'true|search_path=""|true', 'report_post is SECURITY DEFINER, with an empty search_path, owned as the other report functions are');
SELECT t.eq((SELECT p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|'
                    || coalesce((SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',')
                                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                   LEFT JOIN pg_roles r ON r.oid = x.grantee
                                  WHERE coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')), '<none>')
               FROM pg_proc p WHERE p.oid = 'private_sec.user_reports_post_via_rpc()'::regprocedure),
  'false|search_path=""|<none>', 'the insert guard runs as the caller (so it sees the API role), with no API grant');
SELECT t.eq((SELECT pg_get_triggerdef(tg.oid) || '|' || tg.tgenabled::text FROM pg_trigger tg
              WHERE tg.tgrelid = 'public.user_reports'::regclass AND tg.tgname = 'user_reports_post_via_rpc'),
  'CREATE TRIGGER user_reports_post_via_rpc BEFORE INSERT ON public.user_reports FOR EACH ROW EXECUTE FUNCTION private_sec.user_reports_post_via_rpc()|O',
  'the insert guard fires before every insert');

ROLLBACK;
