-- PRIV-2D (2/3): a host cannot put the location of a youth-inclusive game into the game's public text.
--
-- Applies to every game that is NOT an enforced adult-only game (a game with no age limit counts as youth-inclusive),
-- for every caller including the service role. Checked columns: title, description, neighborhood, game_rules, equipment,
-- positions_needed, cancellation_reason, cancellation_notes.
--
-- WHEN IT RUNS. On insert; when a game becomes youth-inclusive; when its location changes (so text written earlier is
-- re-checked against the new venue); and for each text column whose value changes. A game that was already holding an
-- offending text before this migration is NOT blocked from unrelated updates (a join count, a cancellation, a status
-- change touch none of these columns), so no existing workflow breaks; legacy rows are found with
-- public.list_youth_games_with_location_text() and handled by a moderator.
--
-- WHAT IT DOES. Refuses with LOCATION_IN_PUBLIC_TEXT and says which field and why, so the host can describe the area instead
-- (a neighborhood or city). Exception: cancellation_reason and cancellation_notes are never allowed to block a cancellation;
-- an offending value is replaced with a fixed sentence. `neighborhood` is also limited to 80 characters and may not be a URL,
-- because the coarse form of the game is built from it.
--
-- The trigger is named a0_ so it runs before a1_sync_hosted_game_private_trg and sees the location exactly as submitted
-- (after the coarsening switch is on, that trigger replaces it with the coarse label).
CREATE OR REPLACE FUNCTION public.guard_youth_game_public_text()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _youth     boolean := NOT public.game_age_range_is_adult_only(NEW.min_age, NEW.max_age);
  _was_youth boolean := false;
  _all       boolean;
  _new       jsonb := to_jsonb(NEW);
  _old       jsonb;
  _exact     text[];
  _field     text;
  _val       text;
  _loc       text;
  _reason    text;
  _removed   constant text := 'Details were removed because they included a location.';
BEGIN
  IF NOT _youth THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    _old := to_jsonb(OLD);
    _was_youth := NOT public.game_age_range_is_adult_only(OLD.min_age, OLD.max_age);
  END IF;
  _all := TG_OP = 'INSERT' OR NOT _was_youth OR NEW.location IS DISTINCT FROM OLD.location;

  -- every exact form of the venue we know about: as submitted now, and the private copy
  _exact := ARRAY[NEW.location];
  IF TG_OP = 'UPDATE' THEN
    _exact := _exact || ARRAY(SELECT p.location FROM public.hosted_game_private p WHERE p.game_id = NEW.id);
  END IF;

  FOREACH _field IN ARRAY ARRAY['title', 'description', 'neighborhood', 'game_rules', 'equipment', 'positions_needed',
                                'cancellation_reason', 'cancellation_notes'] LOOP
    _val := _new ->> _field;
    CONTINUE WHEN _val IS NULL OR btrim(_val) = '';
    CONTINUE WHEN NOT _all AND _val IS NOT DISTINCT FROM (_old ->> _field);
    IF _field = 'neighborhood' THEN
      IF length(_val) > 80 OR _val ~* '^\s*(https?://|www\.)' THEN
        RAISE EXCEPTION 'LOCATION_IN_PUBLIC_TEXT: the neighborhood of a game that includes children must be a short area name (a neighborhood or city), not a link or a long description.'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    _reason := private_sec.text_discloses_location(_val, NULL);
    IF _reason IS NULL THEN
      FOREACH _loc IN ARRAY _exact LOOP
        _reason := private_sec.text_discloses_location(_val, _loc);
        EXIT WHEN _reason IS NOT NULL;
      END LOOP;
    END IF;
    CONTINUE WHEN _reason IS NULL;

    IF _field = 'cancellation_reason' THEN
      NEW.cancellation_reason := _removed;       -- never block a cancellation
    ELSIF _field = 'cancellation_notes' THEN
      NEW.cancellation_notes := _removed;
    ELSE
      RAISE EXCEPTION 'LOCATION_IN_PUBLIC_TEXT: the % of a game that includes children cannot contain an address, map link, coordinates or the venue name (found: %). Describe the area instead, for example a neighborhood or city. The exact place is shared with people who have joined.',
        _field, _reason USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_youth_game_public_text() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_youth_game_public_text() TO service_role;

DROP TRIGGER IF EXISTS a0_guard_youth_game_public_text_trg ON public.hosted_games;
CREATE TRIGGER a0_guard_youth_game_public_text_trg BEFORE INSERT OR UPDATE ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.guard_youth_game_public_text();

-- Moderation: find games that already hold a disclosing text (written before this guard, or reached by a path the
-- heuristic could not see). Returns the game, the field and the reason, never the text. Moderators, admins and the
-- service role only. Handling is the existing moderation tools (hide the listing, ask the host to edit).
CREATE OR REPLACE FUNCTION public.list_youth_games_with_location_text()
RETURNS TABLE (game_id text, field text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _g      record;
  _field  text;
  _val    text;
  _reason text;
  _loc    text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  FOR _g IN
    SELECT g.id, to_jsonb(g) AS j, g.location AS pub_loc, p.location AS priv_loc
      FROM public.hosted_games g LEFT JOIN public.hosted_game_private p ON p.game_id = g.id
     WHERE NOT public.game_age_range_is_adult_only(g.min_age, g.max_age)
  LOOP
    FOREACH _field IN ARRAY ARRAY['title', 'description', 'neighborhood', 'game_rules', 'equipment', 'positions_needed',
                                  'cancellation_reason', 'cancellation_notes'] LOOP
      _val := _g.j ->> _field;
      CONTINUE WHEN _val IS NULL OR btrim(_val) = '';
      _reason := private_sec.text_discloses_location(_val, NULL);
      IF _reason IS NULL THEN
        FOREACH _loc IN ARRAY ARRAY[_g.pub_loc, _g.priv_loc] LOOP
          _reason := private_sec.text_discloses_location(_val, _loc);
          EXIT WHEN _reason IS NOT NULL;
        END LOOP;
      END IF;
      IF _reason IS NOT NULL THEN
        game_id := _g.id; field := _field; reason := _reason;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.list_youth_games_with_location_text() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_youth_games_with_location_text() TO authenticated, service_role;
