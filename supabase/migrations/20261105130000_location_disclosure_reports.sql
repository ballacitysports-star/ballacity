-- G6: review handling for location disclosures the detector cannot reliably identify.
--
-- The text detector (20261104130000) refuses an address, map link, coordinates, unit or the venue name. It cannot see a paraphrase
-- ("the school on the corner of ...") and it is not a security boundary. This adds the human path:
--   * a report reason, location_disclosed ("Reveals a private location"), in the existing report flow;
--   * when two different people report the same game that may include children (a game with no age limit counts), its free
--     text is removed automatically (title, description, neighborhood, rules, equipment, cancellation text), the host is told, the
--     reports are marked actioned and the event is audited. No copy of the removed text is kept, so the audit trail does not
--     become a second copy of the disclosure. The host can describe the area again; the PRIV-2D guard applies to what they write;
--   * moderators can do the same on one report (moderator_scrub_game_text), scrub a team post (moderator_scrub_team_post_text) and
--     scan team posts for disclosures (list_team_posts_with_location_text), like the existing game scan.
-- A single report never changes a listing by itself, so one person cannot blank a rival's game. Automatic removal needs two
-- distinct reporters within 30 days; reporters' identities are never shown to the host.
-- Depends on 20261104130000 (detector) and 20261104140000 (game scan).

ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_reason_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_reason_check CHECK (reason = ANY (ARRAY[
  'spam','harassment','inappropriate','impersonation','safety','other','threats','fake_account','scam','unsafe_behavior',
  'minor_safety','fake_game','unsafe_location','misleading','illegal','payment_scam','payment_not_received','payment_pressure',
  'unsafe_conditions','injury_risk','location_disclosed']));

-- Removes the free text of a game. No copy is kept. Definer only.
CREATE OR REPLACE FUNCTION private_sec.scrub_game_public_text(_game text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  UPDATE public.hosted_games g
     SET title = initcap(g.sport) || ' game', description = '', neighborhood = '', game_rules = NULL,
         equipment = '{}', cancellation_notes = NULL, cancellation_reason = NULL
   WHERE g.id = _game;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END $$;
REVOKE ALL ON FUNCTION private_sec.scrub_game_public_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.scrub_game_public_text(text) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.tell_host_location_removed(_host uuid, _link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_host, 'moderation_notice', 'Please check your listing',
          'Text that may have revealed a private location was removed from your listing. You can describe the area again (a neighborhood or city); the exact place is shared with people who have joined.',
          _link)
$$;
REVOKE ALL ON FUNCTION private_sec.tell_host_location_removed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.tell_host_location_removed(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_location_disclosure_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _g record;
  _reporters integer;
BEGIN
  IF NEW.reason IS DISTINCT FROM 'location_disclosed' OR NEW.game_id IS NULL THEN RETURN NEW; END IF;
  SELECT g.id, g.host_id, g.min_age, g.max_age INTO _g FROM public.hosted_games g WHERE g.id = NEW.game_id;
  IF NOT FOUND OR public.game_age_range_is_adult_only(_g.min_age, _g.max_age) THEN RETURN NEW; END IF;
  SELECT count(DISTINCT r.reporter_id) INTO _reporters FROM public.user_reports r
   WHERE r.game_id = NEW.game_id AND r.reason = 'location_disclosed' AND r.created_at > now() - interval '30 days'
     AND r.status IN ('new', 'open', 'pending', 'investigating', 'reviewing');
  IF _reporters >= 2 THEN
    PERFORM private_sec.scrub_game_public_text(NEW.game_id);
    PERFORM private_sec.tell_host_location_removed(_g.host_id, '/games/' || NEW.game_id);
    UPDATE public.user_reports SET status = 'actioned', reviewed_at = now(),
           resolution_notes = 'Listing text removed automatically after two independent reports; a moderator should review.'
     WHERE game_id = NEW.game_id AND reason = 'location_disclosed'
       AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing');
    INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    VALUES (NULL, 'location_disclosure_autoscrub', 'hosted_game', NEW.game_id, 'two independent reports', jsonb_build_object('reporters', _reporters));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_location_disclosure_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_location_disclosure_report() TO service_role;
DROP TRIGGER IF EXISTS zz_location_disclosure_report_trg ON public.user_reports;
CREATE TRIGGER zz_location_disclosure_report_trg AFTER INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_location_disclosure_report();

CREATE OR REPLACE FUNCTION public.moderator_scrub_game_text(_game text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _host uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  SELECT host_id INTO _host FROM public.hosted_games WHERE id = _game;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM private_sec.scrub_game_public_text(_game);
  PERFORM private_sec.tell_host_location_removed(_host, '/games/' || _game);
  UPDATE public.user_reports SET status = 'actioned', reviewed_by = auth.uid(), reviewed_at = now(),
         resolution_notes = COALESCE(left(_reason, 500), 'Listing text removed by a moderator')
   WHERE game_id = _game AND reason = 'location_disclosed' AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing');
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'location_disclosure_scrub', 'hosted_game', _game, left(_reason, 500));
END $$;

CREATE OR REPLACE FUNCTION public.moderator_scrub_team_post_text(_post uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _author uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  SELECT author_id INTO _author FROM public.team_posts WHERE id = _post;
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.team_posts SET title = 'Team update', body = '' WHERE id = _post;
  PERFORM private_sec.tell_host_location_removed(_author, NULL);
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'location_disclosure_scrub', 'team_post', _post::text, left(_reason, 500));
END $$;

-- Scan of team posts of teams that include young people (age group youth/teen), like list_youth_games_with_location_text().
CREATE OR REPLACE FUNCTION public.list_team_posts_with_location_text()
RETURNS TABLE (post_id uuid, field text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _p record; _field text; _val text; _reason text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  FOR _p IN
    SELECT p.id, to_jsonb(p) AS j, p.location AS loc
      FROM public.team_posts p JOIN public.teams t ON t.id = p.team_id
     WHERE t.age_groups && ARRAY['youth', 'teen']::text[]
  LOOP
    FOREACH _field IN ARRAY ARRAY['title', 'body'] LOOP
      _val := _p.j ->> _field;
      CONTINUE WHEN _val IS NULL OR btrim(_val) = '';
      _reason := COALESCE(private_sec.text_discloses_location(_val, NULL), private_sec.text_discloses_location(_val, _p.loc));
      IF _reason IS NOT NULL THEN
        post_id := _p.id; field := _field; reason := _reason;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.moderator_scrub_game_text(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.moderator_scrub_team_post_text(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_team_posts_with_location_text() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_scrub_game_text(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.moderator_scrub_team_post_text(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_team_posts_with_location_text() TO authenticated, service_role;
