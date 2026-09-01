-- 1. Privacy preferences ---------------------------------------------------
CREATE TABLE public.privacy_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_visibility text NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public','members','private')),
  location_precision text NOT NULL DEFAULT 'approximate'
    CHECK (location_precision IN ('approximate','city','hidden')),
  show_sports boolean NOT NULL DEFAULT true,
  show_games_played boolean NOT NULL DEFAULT true,
  allow_messages text NOT NULL DEFAULT 'everyone'
    CHECK (allow_messages IN ('everyone','shared','nobody')),
  allow_invites text NOT NULL DEFAULT 'everyone'
    CHECK (allow_invites IN ('everyone','shared','nobody')),
  marketing_emails boolean NOT NULL DEFAULT false,
  ai_processing boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.privacy_preferences TO authenticated;
GRANT ALL ON public.privacy_preferences TO service_role;

ALTER TABLE public.privacy_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own privacy preferences" ON public.privacy_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users create own privacy preferences" ON public.privacy_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own privacy preferences" ON public.privacy_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER privacy_preferences_touch
  BEFORE UPDATE ON public.privacy_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Read a single privacy setting for any user (returns NULL when unset).
CREATE OR REPLACE FUNCTION public.privacy_text(_user uuid, _key text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(p) ->> _key
  FROM public.privacy_preferences p
  WHERE p.user_id = _user;
$$;

REVOKE ALL ON FUNCTION public.privacy_text(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.privacy_text(uuid, text) TO authenticated, service_role;

-- 2. Profile visibility ----------------------------------------------------
DROP POLICY IF EXISTS "Profiles viewable by anon" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;

CREATE POLICY "Public profiles viewable by anon" ON public.profiles
  FOR SELECT TO anon
  USING (
    COALESCE((SELECT pp.profile_visibility FROM public.privacy_preferences pp WHERE pp.user_id = profiles.id), 'public') = 'public'
  );

CREATE POLICY "Profiles viewable by members" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR COALESCE((SELECT pp.profile_visibility FROM public.privacy_preferences pp WHERE pp.user_id = profiles.id), 'public') IN ('public','members')
  );

-- 3. Location minimization -------------------------------------------------
-- Availability coordinates are never stored at street precision: they are
-- coarsened to ~1km (2 decimals) or dropped entirely, per the owner's setting.
CREATE OR REPLACE FUNCTION public.apply_availability_location_privacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mode text := COALESCE(public.privacy_text(NEW.user_id, 'location_precision'), 'approximate');
BEGIN
  IF _mode = 'hidden' THEN
    NEW.lat := NULL; NEW.lng := NULL; NEW.formatted_address := NULL; NEW.place_id := NULL; NEW.city := NULL;
  ELSIF _mode = 'city' THEN
    NEW.lat := NULL; NEW.lng := NULL; NEW.formatted_address := NULL; NEW.place_id := NULL;
  ELSE
    NEW.lat := round(NEW.lat, 2);
    NEW.lng := round(NEW.lng, 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS availability_location_privacy ON public.player_availabilities;
CREATE TRIGGER availability_location_privacy
  BEFORE INSERT OR UPDATE ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.apply_availability_location_privacy();

UPDATE public.player_availabilities
   SET lat = round(lat, 2), lng = round(lng, 2)
 WHERE lat IS NOT NULL OR lng IS NOT NULL;

-- 4. Contact / message gating ---------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_contact_request_privacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key text := CASE WHEN NEW.kind = 'invite' THEN 'allow_invites' ELSE 'allow_messages' END;
  _mode text;
BEGIN
  _mode := COALESCE(public.privacy_text(NEW.to_user_id, _key), 'everyone');
  IF _mode = 'nobody' THEN
    RAISE EXCEPTION 'This player is not accepting %.', CASE WHEN NEW.kind = 'invite' THEN 'game invitations' ELSE 'new messages' END;
  ELSIF _mode = 'shared' AND NOT public.shares_game_or_chat(NEW.from_user_id, NEW.to_user_id) THEN
    RAISE EXCEPTION 'This player only accepts % from people they share a game or chat with.', CASE WHEN NEW.kind = 'invite' THEN 'game invitations' ELSE 'messages' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_request_privacy ON public.availability_contact_requests;
CREATE TRIGGER contact_request_privacy
  BEFORE INSERT ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contact_request_privacy();

CREATE OR REPLACE FUNCTION public.create_direct_conversation(_other_user uuid, _game_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _existing uuid;
  _new_id uuid;
  _mode text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  SELECT cp1.conversation_id INTO _existing
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  WHERE cp1.user_id = _me AND cp2.user_id = _other_user
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  _mode := COALESCE(public.privacy_text(_other_user, 'allow_messages'), 'everyone');
  IF _mode = 'nobody' THEN
    RAISE EXCEPTION 'This player is not accepting new messages.';
  ELSIF _mode = 'shared' AND NOT public.shares_game_or_chat(_me, _other_user) THEN
    RAISE EXCEPTION 'This player only accepts messages from people they share a game or chat with.';
  END IF;

  INSERT INTO public.conversations (created_by, game_id)
  VALUES (_me, _game_id)
  RETURNING id INTO _new_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (_new_id, _me), (_new_id, _other_user);

  RETURN _new_id;
END;
$function$;

-- 5. Data minimization: never store payment credentials -------------------
CREATE OR REPLACE FUNCTION public.reject_payment_credentials()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _blob text := lower(concat_ws(' ',
    to_jsonb(NEW) ->> 'username',
    to_jsonb(NEW) ->> 'label',
    to_jsonb(NEW) ->> 'contact_info',
    to_jsonb(NEW) ->> 'instructions',
    to_jsonb(NEW) ->> 'payment_url',
    to_jsonb(NEW) ->> 'notes',
    to_jsonb(NEW) ->> 'transaction_reference'
  ));
  _digits text := regexp_replace(_blob, '[^0-9]', '', 'g');
BEGIN
  IF _blob ~ '(cvv|cvc|security code|card number|routing number|account password|bank password|pin code)' THEN
    RAISE EXCEPTION 'Never enter card, bank, or password details here. OpenRun does not store payment credentials.';
  END IF;
  IF length(_digits) >= 13 AND _blob ~ '(\d[ -]?){13,19}' THEN
    RAISE EXCEPTION 'That looks like a card or bank account number. OpenRun does not store payment credentials — use your payment app handle instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS no_payment_credentials ON public.host_payment_methods;
CREATE TRIGGER no_payment_credentials
  BEFORE INSERT OR UPDATE ON public.host_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.reject_payment_credentials();

DROP TRIGGER IF EXISTS no_payment_credentials ON public.payment_submissions;
CREATE TRIGGER no_payment_credentials
  BEFORE INSERT OR UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reject_payment_credentials();