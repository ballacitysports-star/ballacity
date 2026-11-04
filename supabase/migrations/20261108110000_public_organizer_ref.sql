-- SEC-5 (approval C, SEC-1 open item D-5): a public organizer reference that is not the organizer's account id.
--
-- PROBLEM. hosted_games.host_id is readable on every game a signed-in account can read, youth-inclusive games included. It is the same value on
-- every game a person hosts, so one leak (an old snapshot, a shared link, a roster) ties all of a minor's games to them, and it is the account id
-- that other tables use. Two more objects carried it next to a youth game for unrelated viewers:
--   * hosted_games.image: a custom cover is stored as storage://game-covers/<host account id>/<file>, so the path itself is the host's id;
--   * join_requests.host_id: anyone can ask to join a public game and then read their own request, host_id included; and the insert trigger
--     refused a request whose host_id did not match the game, so a request was also a yes/no test of "is this account the host of that game".
--
-- WHAT THIS DOES (phase 1: additive; nothing that works today stops working):
--   1. hosted_games.organizer_ref: an opaque random uuid per game, set by the database (a client cannot choose or change it), so two games by
--      the same person share nothing. It is what a public page can use to refer to "the organizer of this game".
--   2. private_sec.game_organizer_for_caller(game): what the caller may learn about a game's organizer: the host id and the cover path unless the
--      host is not a confirmed adult and the caller is neither the host nor someone who may know a minor's name (private_sec.can_see_minor_name:
--      guardians, people who share a game, chat or team, staff dealing with them, accepted followers, administrators and moderators: the rule
--      get_game_organizer and the R1 restrictions already use), plus "is this my game".
--   3. public.hosted_games_public: a security_invoker view over hosted_games (the table's row security decides which rows come back, exactly as
--      before) with host_id and image masked as above, plus organizer_ref, viewer_is_host and organizer_hidden. public.join_requests_visible does
--      the same for join requests. Both read the masked values through the definer function, never the base columns, so they keep working once
--      phase 2 revokes those columns.
--   4. A join request's host_id is filled in by the database from the game (a00_fill_join_request_host_trg). A client no longer needs to know the
--      host to ask to join, and a wrong host_id is corrected instead of refused, so the insert is no longer an oracle.
--   5. Five roster/waitlist policies and the game-cover storage read policy read hosted_games.host_id / image in a sub-select, which IS subject
--      to the caller's column privileges. They are recreated with the same rules through definer helpers (private_sec.is_game_host,
--      private_sec.game_cover_readable), so phase 2 does not break them. private_sec.game_cover_hidden_for_caller is added for phase 2's
--      storage policy (a cover's folder name is the uploader's account id).
--   6-8. Review corrections (780eaf8f, docs/privacy/sec5-public-organizer-ref.md "Final review (780eaf8f) corrections"): the waitlist
--      reviewer is written by the database and closed to the API roles; a game report names the host server-side and the reporter can no
--      longer read reported_id; payment settings are read through public.game_payment_settings_visible (holder masked like the host);
--      hosted_games_public gives a hidden organizer the neutral host_snapshot instead of a stored personal one.
-- PHASE 2 (separately approved, prepared in supabase/phase2/sec5_phase2_close_host_id_columns.sql, tested in 510 inside a rolled-back
-- transaction): column-level revoke of hosted_games.host_id, image and host_snapshot, join_requests.host_id and game_payment_settings.host_id
-- from the API roles. Realtime payloads follow column privileges, so phase 2 also strips them there. See docs/privacy/sec5-public-organizer-ref.md.
--
-- host_id stays where it is: every foreign key, policy, trigger, payment and moderation path keeps using it (policies are not subject to column
-- grants). The view does not reproduce row security; it is security_invoker over the table. Depends on 20261107100000 (SEC-1) and
-- 20261107110000 (PAY-1). Redefines no helper wrapped by SEC-2 (20261103150000), so wrap_oracle_helpers() needs no re-run. Forward-only.

SET LOCAL lock_timeout = '10s';

-- Dependency guard: fail loudly, before changing anything, if a migration this one needs has not been applied.
DO $guard$ BEGIN
  IF to_regprocedure('private_sec.can_see_minor_name(uuid,uuid)') IS NULL OR to_regprocedure('public.age_cohort_of(uuid)') IS NULL
     OR to_regprocedure('private_sec.minor_host_public_snapshot(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('private_sec.game_payee(text)') IS NULL OR to_regprocedure('public.get_game_organizer(text)') IS NULL
     OR to_regprocedure('public.validate_join_request()') IS NULL
     OR to_regprocedure('private_sec.is_game_host(text)') IS NULL OR to_regprocedure('private_sec.is_game_participant(text,uuid)') IS NULL
     OR to_regprocedure('private_sec.can_read_game_payment_settings(text,uuid)') IS NULL
     OR to_regclass('public.game_position_waitlist') IS NULL OR to_regclass('public.user_reports') IS NULL
     OR to_regclass('public.game_payment_settings') IS NULL
     OR to_regclass('public.hosted_games') IS NULL OR to_regclass('public.join_requests') IS NULL THEN
    RAISE EXCEPTION 'SEC-5: a required earlier release migration has not been applied (see docs/release/youth-privacy-release-runbook.md, sections 2 and 16)';
  END IF;
END $guard$;

-- ------------------------------------------------------------------------------------------------------------ 1. organizer_ref
-- A volatile default fills every existing row with its own value while the column is added (no UPDATE, so no row trigger fires).
ALTER TABLE public.hosted_games ADD COLUMN IF NOT EXISTS organizer_ref uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS hosted_games_organizer_ref_key ON public.hosted_games (organizer_ref);
COMMENT ON COLUMN public.hosted_games.organizer_ref IS
  'SEC-5: opaque per-game organizer reference. Random, set by the database, never equal across games; not the host account id.';

-- The database chooses it: a client could otherwise give two games the same value (or a value derived from the account) and link them.
CREATE OR REPLACE FUNCTION public.keep_organizer_ref()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.organizer_ref := gen_random_uuid();
  ELSE
    NEW.organizer_ref := OLD.organizer_ref;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_organizer_ref() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keep_organizer_ref() TO service_role;
DROP TRIGGER IF EXISTS a00_keep_organizer_ref_trg ON public.hosted_games;
CREATE TRIGGER a00_keep_organizer_ref_trg BEFORE INSERT OR UPDATE OF organizer_ref ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.keep_organizer_ref();

-- ------------------------------------------------------------------------------------------------------------ 2. what the caller may learn
-- True when the organizer must be hidden from _viewer: the host is not a confirmed adult (unknown age counts as not adult, as for the neutral
-- snapshot) and the viewer is not the host and not someone who may know a minor's name.
CREATE OR REPLACE FUNCTION private_sec.organizer_hidden_for(_host uuid, _viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _host IS NOT NULL
     AND COALESCE(public.age_cohort_of(_host), 'unknown') <> 'adult'
     AND NOT (_viewer IS NOT NULL AND (_viewer = _host OR private_sec.can_see_minor_name(_viewer, _host)))
$$;
REVOKE ALL ON FUNCTION private_sec.organizer_hidden_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.organizer_hidden_for(uuid, uuid) TO service_role;

-- One row per game: the host id and the cover the caller may see, whether the caller hosts it, and whether the organizer is hidden from them.
-- Executable by the API roles only because the security_invoker views call it; private_sec is not an exposed API schema (SEC-2), and the
-- answers are only ever about the caller's own relationship to the game.
CREATE OR REPLACE FUNCTION private_sec.game_organizer_for_caller(_game text)
-- host_snapshot: a game written before the neutral-snapshot rule (or never neutralized: the SEC-1 maintenance batch is not run by any
-- migration) can still hold the minor's personal snapshot (name, username, avatar), so a hidden organizer gets the neutral snapshot computed
-- now, exactly as a new game by them would store it.
RETURNS TABLE (host_id uuid, viewer_is_host boolean, organizer_hidden boolean, image text, host_snapshot jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN h.hidden THEN NULL ELSE g.host_id END,
         h.mine,
         h.hidden,
         CASE WHEN h.hidden THEN '' ELSE g.image END,
         CASE WHEN h.hidden THEN private_sec.minor_host_public_snapshot(g.id, g.host_id, g.team_id, g.org_id, g.hosting_approval_id)
              ELSE g.host_snapshot END
    FROM public.hosted_games g
   CROSS JOIN LATERAL (
     SELECT (auth.uid() IS NOT NULL AND g.host_id = auth.uid()) AS mine,
            (g.host_id IS DISTINCT FROM auth.uid() AND private_sec.organizer_hidden_for(g.host_id, auth.uid())) AS hidden
   ) h
   WHERE g.id = _game
$$;
REVOKE ALL ON FUNCTION private_sec.game_organizer_for_caller(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.game_organizer_for_caller(text) TO anon, authenticated, service_role;

-- A game cover lives at game-covers/<uploader account id>/<file>. Phase 2 adds a restrictive storage policy with this check, so an unrelated
-- account can neither sign nor list the cover folder of a host who is not a confirmed adult (the folder name is the account id).
CREATE OR REPLACE FUNCTION private_sec.game_cover_hidden_for_caller(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT private_sec.organizer_hidden_for(public.try_uuid(split_part(_name, '/', 1)), auth.uid())
$$;
REVOKE ALL ON FUNCTION private_sec.game_cover_hidden_for_caller(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.game_cover_hidden_for_caller(text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------ 3. the client read paths
-- Every column of hosted_games except host_id, image and host_snapshot is read straight from the table (so row security and column grants
-- apply as for the caller); those three come masked from the definer function. A new hosted_games column must be added here too (510 checks).
DROP VIEW IF EXISTS public.hosted_games_public;
CREATE VIEW public.hosted_games_public WITH (security_invoker = true, security_barrier = true) AS
SELECT g.id,
       o.host_id,
       g.organizer_ref,
       COALESCE(o.viewer_is_host, false) AS viewer_is_host,
       COALESCE(o.organizer_hidden, true) AS organizer_hidden,
       g.sport, g.title, g.date, g.duration, g.location, g.neighborhood, g.distance_mi, g.lat, g.lng, g.max_players, g.joined, g.skill,
       g.price, g.indoor, g.is_private, g.urgent, g.trending,
       COALESCE(o.image, '') AS image,
       g.description, g.equipment, g.status, g.joins_closed, o.host_snapshot, g.created_at, g.updated_at, g.positions_needed, g.team_id,
       g.org_id, g.signup_cutoff_min, g.hidden_at, g.min_age, g.max_age, g.series_id, g.ends_at, g.all_day, g.timezone, g.arrive_early_min,
       g.rrule, g.reminder_offsets, g.min_players, g.allow_waitlist, g.cancellation_policy, g.cancellation_notes, g.game_rules,
       g.cancelled_at, g.cancellation_reason, g.completed_at, g.org_official, g.org_hidden_at, g.org_hidden_by, g.cancel_cutoff_min,
       g.owner_hidden_at, g.moderator_hidden_at,
       CASE WHEN COALESCE(o.organizer_hidden, true) THEN NULL ELSE g.hosting_approval_id END AS hosting_approval_id
  FROM public.hosted_games g
  LEFT JOIN LATERAL private_sec.game_organizer_for_caller(g.id) o ON true;
COMMENT ON VIEW public.hosted_games_public IS
  'SEC-5: the client read path for games. Same rows as hosted_games (security_invoker); host_id and image are NULL/empty, and host_snapshot is the neutral snapshot, when the host is not a confirmed adult and the caller is unrelated; organizer_ref is per game; viewer_is_host is "this is my game".';
REVOKE ALL ON public.hosted_games_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hosted_games_public TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.join_requests_visible;
CREATE VIEW public.join_requests_visible WITH (security_invoker = true, security_barrier = true) AS
SELECT jr.id, jr.game_id, jr.player_id,
       o.host_id,
       COALESCE(o.viewer_is_host, false) AS viewer_is_host,
       jr.status, jr.message, jr.reviewer_notes, jr.created_at, jr.reviewed_at, jr.idempotency_key, jr.attempt_count, jr.last_rejected_at,
       jr.guardian_approved_at, jr.guardian_approved_by
  FROM public.join_requests jr
  LEFT JOIN LATERAL private_sec.game_organizer_for_caller(jr.game_id) o ON true;
COMMENT ON VIEW public.join_requests_visible IS
  'SEC-5: the client read path for join requests. Same rows as join_requests (security_invoker); host_id masked like hosted_games_public; viewer_is_host replaces filtering on host_id.';
REVOKE ALL ON public.join_requests_visible FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.join_requests_visible TO authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------ 4. join requests name their host server-side
-- Runs before every other insert trigger on join_requests (the host-block check, the age rules and validate_join_request all read host_id),
-- so each of them sees the real host. A request for an id that is not a hosted game keeps what the client sent (legacy local games).
CREATE OR REPLACE FUNCTION public.fill_join_request_host()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _host uuid;
BEGIN
  SELECT g.host_id INTO _host FROM public.hosted_games g WHERE g.id = NEW.game_id;
  IF _host IS NOT NULL THEN NEW.host_id := _host; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fill_join_request_host() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_join_request_host() TO service_role;
DROP TRIGGER IF EXISTS a00_fill_join_request_host_trg ON public.join_requests;
CREATE TRIGGER a00_fill_join_request_host_trg BEFORE INSERT ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.fill_join_request_host();

-- ------------------------------------------------------------------------------------------------------------ 5. policies that read host_id from another table
-- A sub-select inside a policy is checked against the caller's column privileges, so these would fail with "permission denied for table
-- hosted_games" once phase 2 revokes host_id and image. Same rules, now through definer helpers (private_sec.is_game_host already exists:
-- auth.uid() hosts the game). Recreated with the same names, commands and roles; nothing a caller can see or do changes.
DROP POLICY IF EXISTS "Host or same-game participants view roster" ON public.game_participants;
CREATE POLICY "Host or same-game participants view roster" ON public.game_participants FOR SELECT
  USING (user_id = auth.uid() OR private_sec.is_game_host(game_id) OR private_sec.is_game_participant(game_id, auth.uid()));
DROP POLICY IF EXISTS "Hosts can remove participants from their games" ON public.game_participants;
CREATE POLICY "Hosts can remove participants from their games" ON public.game_participants FOR DELETE TO authenticated
  USING (private_sec.is_game_host(game_id));
DROP POLICY IF EXISTS "Host or waitlisted user view waitlist" ON public.game_position_waitlist;
CREATE POLICY "Host or waitlisted user view waitlist" ON public.game_position_waitlist FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private_sec.is_game_host(game_id));
DROP POLICY IF EXISTS "Host can review waitlist entries for their games" ON public.game_position_waitlist;
CREATE POLICY "Host can review waitlist entries for their games" ON public.game_position_waitlist FOR UPDATE TO authenticated
  USING (private_sec.is_game_host(game_id)) WITH CHECK (private_sec.is_game_host(game_id));
DROP POLICY IF EXISTS "Host can remove waitlist entries for their games" ON public.game_position_waitlist;
CREATE POLICY "Host can remove waitlist entries for their games" ON public.game_position_waitlist FOR DELETE TO authenticated
  USING (private_sec.is_game_host(game_id));

-- Storage: the game-cover read rule, unchanged, moved into a definer helper (it reads hosted_games.image and host_id).
CREATE OR REPLACE FUNCTION private_sec.game_cover_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hosted_games g
     WHERE g.image LIKE ('%' || _name || '%')
       AND (g.is_private IS NOT TRUE
            OR g.host_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.game_participants gp WHERE gp.game_id = g.id AND gp.user_id = auth.uid())
            OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id AND jr.player_id = auth.uid() AND jr.status = 'approved')))
$$;
REVOKE ALL ON FUNCTION private_sec.game_cover_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.game_cover_readable(text) TO authenticated, service_role;
DROP POLICY IF EXISTS "Authenticated read game covers" ON storage.objects;
CREATE POLICY "Authenticated read game covers" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'game-covers' AND ((auth.uid())::text = (storage.foldername(name))[1] OR private_sec.game_cover_readable(name)));

-- ------------------------------------------------------------------------------------------------------------ 6. waitlist reviewer (review 780eaf8f, F1)
-- game_position_waitlist.reviewed_by is the account that approved or declined a place: the host. The waitlisted person reads their own row
-- (and gets it in realtime payloads), so for a minor host it handed their account id to a stranger who only asked for a place. The database
-- now writes reviewed_by itself (a client cannot name someone else, or the host by a guessable value), and the column is closed to the API
-- roles in this phase already: no client reads it (src/lib/waitlist-store.ts lists its columns), and realtime drops columns the subscriber
-- cannot SELECT. The platform (service role, no auth.uid()) keeps what it writes.
CREATE OR REPLACE FUNCTION public.fill_waitlist_reviewer()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.reviewed_by := NULL;
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    NEW.reviewed_by := auth.uid();
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fill_waitlist_reviewer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_waitlist_reviewer() TO service_role;
DROP TRIGGER IF EXISTS a00_fill_waitlist_reviewer_trg ON public.game_position_waitlist;
CREATE TRIGGER a00_fill_waitlist_reviewer_trg BEFORE INSERT OR UPDATE ON public.game_position_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.fill_waitlist_reviewer();

-- ------------------------------------------------------------------------------------------------------------ 7. game reports (review 780eaf8f, F3)
-- A game report names the game's host as the reported account, taken from the game: the client neither needs to know the host (a stranger
-- may not, for a minor host) nor can it point a game report at someone else. A report about an id that is not a hosted game (a legacy local
-- game) keeps what the client sent, and one with nothing to name is refused like missing team content. Runs before every other insert
-- trigger on user_reports. A trigger function cannot be called directly, so the definer lookup is not an oracle.
CREATE OR REPLACE FUNCTION public.fill_game_report_subject()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _host uuid;
BEGIN
  IF NEW.subject_type IS DISTINCT FROM 'game' THEN RETURN NEW; END IF;
  IF NEW.game_id IS NOT NULL THEN
    SELECT g.host_id INTO _host FROM public.hosted_games g WHERE g.id = NEW.game_id;
  END IF;
  IF _host IS NOT NULL THEN
    NEW.reported_id := _host;               -- never trust the client for who is being reported
  ELSIF NEW.reported_id IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NOT_FOUND: this item is not available to report.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fill_game_report_subject() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_game_report_subject() TO service_role;
DROP TRIGGER IF EXISTS a00_fill_game_report_subject_trg ON public.user_reports;
CREATE TRIGGER a00_fill_game_report_subject_trg BEFORE INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.fill_game_report_subject();

-- The reporter reads their own reports ("Users read their own submitted reports"); a game report now carries the real host, so reported_id
-- is closed to the API roles. Nothing in the client reads it (the data export lists its columns; moderation reads it with the service role).
-- Same mechanism as phase 2: a table-level SELECT covers every column, so it is replaced by a grant on each column that stays open (read from
-- the catalog). A column added to user_reports later must be granted to authenticated explicitly (510 checks the list).
DO $close_phase1$
DECLARE _t record; _cols text; _role text;
BEGIN
  FOR _t IN SELECT * FROM (VALUES ('public.user_reports'::regclass, ARRAY['reported_id']),
                                  ('public.game_position_waitlist'::regclass, ARRAY['reviewed_by'])) v(rel, closed) LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO _cols
      FROM pg_attribute WHERE attrelid = _t.rel AND attnum > 0 AND NOT attisdropped AND attname <> ALL (_t.closed);
    FOREACH _role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(_role, _t.rel, 'SELECT') THEN
        EXECUTE format('REVOKE SELECT ON %s FROM %I', _t.rel, _role);
        EXECUTE format('GRANT SELECT (%s) ON %s TO %I', _cols, _t.rel, _role);
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(_t.closed) c WHERE has_column_privilege(_role, _t.rel, c, 'SELECT')) THEN
        EXECUTE format('REVOKE SELECT (%s) ON %s FROM %I', array_to_string(_t.closed, ', '), _t.rel, _role);
      END IF;
    END LOOP;
  END LOOP;
  IF has_column_privilege('authenticated', 'public.user_reports', 'reported_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.game_position_waitlist', 'reviewed_by', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-5: a closed column is still readable by authenticated (check column grants and PUBLIC)';
  END IF;
END $close_phase1$;

-- ------------------------------------------------------------------------------------------------------------ 8. payment settings holder (review 780eaf8f, F4)
-- game_payment_settings.host_id is the holder of the settings: the payee (an adult) for a paid game, but the host for a free one, a minor
-- included. An approved requester who is not on the roster reads the row and is not someone who may know a minor's name. The client reads
-- the settings through this view, with host_id masked by the same rule as the game, and viewer_is_holder for "my settings"; phase 2 closes
-- the base column. The definer helper answers only for a row the caller's own read policy admits (the same check as the policy).
CREATE OR REPLACE FUNCTION private_sec.payment_settings_holder_for_caller(_settings uuid)
RETURNS TABLE (host_id uuid, viewer_is_holder boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN private_sec.organizer_hidden_for(s.host_id, auth.uid()) THEN NULL ELSE s.host_id END,
         s.host_id = auth.uid()
    FROM public.game_payment_settings s
   WHERE s.id = _settings AND private_sec.can_read_game_payment_settings(s.game_id, s.host_id)
$$;
REVOKE ALL ON FUNCTION private_sec.payment_settings_holder_for_caller(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.payment_settings_holder_for_caller(uuid) TO authenticated, service_role;

DROP VIEW IF EXISTS public.game_payment_settings_visible;
CREATE VIEW public.game_payment_settings_visible WITH (security_invoker = true, security_barrier = true) AS
SELECT s.id, s.game_id,
       o.host_id,
       COALESCE(o.viewer_is_holder, false) AS viewer_is_holder,
       s.entry_fee, s.accepted_method_ids, s.payment_deadline, s.refund_policy, s.payment_instructions, s.created_at, s.updated_at,
       s.requires_approval, s.payment_mode, s.payment_hold_minutes, s.refund_rule, s.late_refund_pct
  FROM public.game_payment_settings s
  LEFT JOIN LATERAL private_sec.payment_settings_holder_for_caller(s.id) o ON true;
COMMENT ON VIEW public.game_payment_settings_visible IS
  'SEC-5: the client read path for game payment settings. Same rows as game_payment_settings (security_invoker); host_id masked like hosted_games_public; viewer_is_holder replaces filtering on host_id.';
REVOKE ALL ON public.game_payment_settings_visible FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.game_payment_settings_visible TO authenticated, service_role;
