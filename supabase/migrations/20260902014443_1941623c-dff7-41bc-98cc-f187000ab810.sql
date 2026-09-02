-- ============================================================
-- 1. Child game participation: consent + guardian control gate
-- ============================================================
CREATE OR REPLACE FUNCTION public.child_game_participation_allowed(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.age_cohort_of(_user) <> 'child_under_13' THEN true
    WHEN public.parental_consent_state(_user) <> 'approved' THEN false
    ELSE COALESCE(
      (SELECT game_participation FROM public.child_controls WHERE child_user_id = _user),
      false)
  END;
$$;

REVOKE ALL ON FUNCTION public.child_game_participation_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.child_game_participation_allowed(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_child_game_participation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE subject uuid;
BEGIN
  subject := COALESCE(
    CASE WHEN TG_TABLE_NAME = 'join_requests' THEN NEW.player_id ELSE NEW.user_id END,
    auth.uid());
  IF subject IS NOT NULL AND NOT public.child_game_participation_allowed(subject) THEN
    RAISE EXCEPTION 'CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account and allow game participation.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_child_game_participation_participants ON public.game_participants;
CREATE TRIGGER enforce_child_game_participation_participants
BEFORE INSERT ON public.game_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_child_game_participation();

DROP TRIGGER IF EXISTS enforce_child_game_participation_requests ON public.join_requests;
CREATE TRIGGER enforce_child_game_participation_requests
BEFORE INSERT ON public.join_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_child_game_participation();

-- ============================================================
-- 2. Username / display-name safety for minors
-- ============================================================
CREATE OR REPLACE FUNCTION public.minor_handle_unsafe(_handle text, _cohort text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE h text;
BEGIN
  IF _handle IS NULL OR _cohort IS NULL THEN RETURN false; END IF;
  IF _cohort NOT IN ('child_under_13', 'teen_13_15', 'teen_16_17') THEN RETURN false; END IF;
  h := lower(_handle);
  -- Email address
  IF h ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN RETURN true; END IF;
  -- Phone number (7+ digits, with or without separators)
  IF regexp_replace(h, '[^0-9]', '', 'g') ~ '\d{7,}' THEN RETURN true; END IF;
  -- Street address
  IF h ~ '\d+\s*(n|s|e|w|north|south|east|west)?\s*[a-z]+\s*(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive|court|ct|way|circle|cir)\b' THEN RETURN true; END IF;
  -- Full date of birth
  IF h ~ '(19|20)\d{2}[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])' THEN RETURN true; END IF;
  IF h ~ '(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](19|20)\d{2}' THEN RETURN true; END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_minor_handle_safety()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.minor_handle_unsafe(NEW.username, NEW.age_cohort)
     OR public.minor_handle_unsafe(NEW.display_name, NEW.age_cohort) THEN
    RAISE EXCEPTION 'MINOR_HANDLE_UNSAFE: remove personal details (email, phone, address or date of birth) from the name or username.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_minor_handle_safety_trg ON public.profiles;
CREATE TRIGGER enforce_minor_handle_safety_trg
BEFORE INSERT OR UPDATE OF username, display_name, age_cohort ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_minor_handle_safety();

-- ============================================================
-- 3. Parent notifications
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_guardians(
  _child uuid, _type text, _title text, _body text, _link text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE allowed boolean;
BEGIN
  SELECT COALESCE(notifications, true) INTO allowed
  FROM public.child_controls WHERE child_user_id = _child;
  IF allowed IS FALSE THEN RETURN; END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT gl.parent_user_id, _type, _title, _body, _link
  FROM public.guardian_links gl
  WHERE gl.child_user_id = _child AND gl.status = 'active';
END $$;

REVOKE ALL ON FUNCTION public.notify_guardians(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_on_consent_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.child_user_id, 'parental_consent',
            'Your account is approved',
            'A parent or guardian approved your OpenRun account. Games, messages and videos follow the settings they chose.',
            '/onboarding/child');
    PERFORM public.notify_guardians(NEW.child_user_id, 'parental_consent',
      'You approved a child account',
      'You can change privacy, messaging and game settings anytime in the Parent Center.',
      '/parent');
  ELSIF NEW.status = 'revoked' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.child_user_id, 'parental_consent',
            'Approval was withdrawn',
            'A parent or guardian withdrew approval, so games, messages and videos are switched off.',
            '/onboarding/child');
    PERFORM public.notify_guardians(NEW.child_user_id, 'parental_consent',
      'Consent revoked',
      'The child account is now restricted. You can request deletion of their data from the Parent Center.',
      '/parent');
  ELSIF NEW.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.child_user_id, 'parental_consent',
            'Waiting for a parent or guardian',
            'We are waiting for your parent or guardian to approve this account.',
            '/onboarding/child');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_on_consent_change_trg ON public.parental_consents;
CREATE TRIGGER notify_on_consent_change_trg
AFTER INSERT OR UPDATE OF status ON public.parental_consents
FOR EACH ROW EXECUTE FUNCTION public.notify_on_consent_change();

CREATE OR REPLACE FUNCTION public.notify_on_child_game_join()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.age_cohort_of(NEW.user_id) IN ('child_under_13', 'teen_13_15') THEN
    PERFORM public.notify_guardians(NEW.user_id, 'child_game',
      'Your child joined a game',
      'Open the Parent Center to review the game, the host and who else is playing.',
      '/parent');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_on_child_game_join_trg ON public.game_participants;
CREATE TRIGGER notify_on_child_game_join_trg
AFTER INSERT ON public.game_participants
FOR EACH ROW EXECUTE FUNCTION public.notify_on_child_game_join();

CREATE OR REPLACE FUNCTION public.notify_on_age_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.age_review_required AND NOT COALESCE(OLD.age_review_required, false) THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.id, 'age_review',
            'Age change under review',
            'Your date of birth changed in a way that would unlock more features, so it is on hold until our safety team reviews it.',
            '/settings');
    PERFORM public.notify_guardians(NEW.id, 'age_review',
      'Age change under review',
      'A date-of-birth change on a linked child account is on hold pending review.',
      '/parent');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_on_age_review_trg ON public.profiles;
CREATE TRIGGER notify_on_age_review_trg
AFTER UPDATE OF age_review_required ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_on_age_review();