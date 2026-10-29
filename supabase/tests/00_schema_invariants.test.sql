-- Rules about the shape of the whole database, checked from the catalog. A
-- failure names the object, so the fix (or a deliberate, reviewed allow-list
-- entry with a reason) is in the same pull request as the change.
BEGIN;

-- 1. Row level security is on for every table the API can reach.
SELECT t.eq(
  (SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity),
  '', 'every table in public has row level security enabled');

-- 2. A SECURITY DEFINER function runs with its owner's rights, so it must pin
--    search_path or a caller can shadow the objects it uses.
SELECT t.eq(
  (SELECT coalesce(string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname), '')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private_sec') AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')),
  '', 'every SECURITY DEFINER function pins its search_path');

-- 3. Which SECURITY DEFINER functions an anonymous visitor may call. Postgres
--    grants EXECUTE to PUBLIC on new functions, so a new definer function is
--    anonymously callable unless its migration revokes that. Trigger functions
--    are left out: they cannot be called directly. Anything new here needs a
--    REVOKE ... FROM PUBLIC, anon in its migration, or a reason added below.
SELECT t.eq(
  (SELECT coalesce(string_agg(sig, E'\n' ORDER BY sig), '') FROM (
     SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'private_sec') AND p.prosecdef
        AND p.prorettype <> 'pg_catalog.trigger'::regtype
        AND has_function_privilege('anon', p.oid, 'EXECUTE')) q
    WHERE sig NOT IN (
      -- private_sec is not exposed by the API; row level security policies call these.
      'private_sec.can_comment_on_minor_content(_commenter uuid, _content_owner uuid)',
      'private_sec.comment_subject_owner(_subject_type text, _subject_id text)',
      'private_sec.guardian_public_profile(_user uuid)',
      'private_sec.profile_visibility_of(_user uuid)',
      'private_sec.reel_game_readable(_game_id text, _owner uuid)',
      'private_sec.reel_publicly_visible(_reel_id uuid)',
      'private_sec.roster_row_visible(_team_id text, _member_user_id uuid)',
      'private_sec.viewer_manages_team(_team text)',
      'private_sec.visible_avatars(_ids uuid[])',
      -- Public by design: the checkout page needs the host's PayPal merchant id and a
      -- game's refund terms before the visitor signs in.
      'public.get_game_host_paypal(_game_id text)',
      'public.get_game_refund_terms(_game_id text)')),
  '', 'no unlisted SECURITY DEFINER function is callable by anonymous visitors');

-- 4. Policies that let an anonymous visitor write. Each is keyed on auth.uid()
--    or auth.role() and so cannot match an anonymous request, or is an
--    intentional anonymous insert. A new one needs a reviewed entry here.
SELECT t.eq(
  (SELECT coalesce(string_agg(entry, E'\n' ORDER BY entry), '') FROM (
     SELECT c.relname || ': ' || p.polname AS entry
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'storage') AND p.polpermissive AND p.polcmd IN ('a', 'w', 'd', '*')
        AND (p.polroles = '{0}' OR (SELECT oid FROM pg_roles WHERE rolname = 'anon') = ANY (p.polroles))) q
    WHERE entry NOT IN (
      'highlight_reels: Users manage own reels',                  -- auth.uid() = user_id
      'notification_preferences: Users manage own notif prefs',   -- auth.uid() = user_id
      'subscriptions: Service role manage subscriptions',         -- auth.role() = ''service_role''
      'auth_signin_events: Users insert own signin events',       -- failed sign-ins are logged with no user
      'location_denial_events: Anyone can record a denial event'  -- anonymous analytics insert
    )),
  '', 'no unlisted policy lets an anonymous visitor write');

-- 5. Private family data is invisible to anyone who is not a party to it.
SELECT t.person('guardian', 40), t.person('teenmid', 14), t.person('stranger', 28), t.person('adminone', 33);
SELECT t.guardian('guardian', 'teenmid');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('adminone'), 'admin');

SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_links'), 0, 'anonymous visitors cannot see guardian links');
SELECT t.eq(t.count('SELECT 1 FROM public.parental_consents'), 0, 'anonymous visitors cannot see parental consents');
SELECT t.eq(t.count('SELECT 1 FROM public.child_controls'), 0, 'anonymous visitors cannot see child controls');
SELECT t.eq(t.count('SELECT 1 FROM public.profile_birthdays'), 0, 'anonymous visitors cannot see birthdays');

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_links'), 0, 'a stranger cannot see guardian links');
SELECT t.eq(t.count('SELECT 1 FROM public.parental_consents'), 0, 'a stranger cannot see parental consents');
SELECT t.eq(t.count('SELECT 1 FROM public.child_controls'), 0, 'a stranger cannot see child controls');
SELECT t.eq(t.count('SELECT 1 FROM public.profile_birthdays WHERE user_id <> auth.uid()'), 0, 'a stranger cannot see anyone else''s birthday');

SELECT t.as_user(t.id('teenmid'));
SELECT t.eq(t.count('SELECT 1 FROM public.profile_birthdays'), 1, 'a player sees their own birthday and no one else''s');
SELECT t.eq(t.count('SELECT 1 FROM public.child_controls'), 1, 'a player sees only their own controls');
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_links'), 1, 'a player sees their own guardian link');
-- The controls are the guardian's to change, not the child's.
SELECT t.eq(t.changed(format('UPDATE public.child_controls SET ai_analysis = true WHERE child_user_id = %L', t.id('teenmid'))), 0,
  'a player cannot change their own controls');

SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.count('SELECT 1 FROM public.child_controls'), 1, 'a guardian sees their child''s controls');
SELECT t.eq(t.count('SELECT 1 FROM public.parental_consents'), 1, 'a guardian sees their child''s consent record');
SELECT t.eq(t.count('SELECT 1 FROM public.profile_birthdays WHERE user_id <> auth.uid()'), 0, 'a guardian cannot see their child''s birthday');
SELECT t.reset();

-- A stored date of birth cannot be edited, by anyone, short of the review flow.
SELECT t.throws(format('UPDATE public.profile_birthdays SET birthday = %L WHERE user_id = %L', current_date - 9000, t.id('teenmid')),
  'BIRTHDAY_LOCKED', 'a stored birthday cannot be changed');

ROLLBACK;
