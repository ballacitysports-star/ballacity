-- PRIV-2D (1/3): one detector for "this free text gives away a place".
--
-- WHY. The coarse form of a youth-inclusive game's location is built from the host's own `neighborhood` text
-- (private_sec.coarse_game_label), and title, description and rules are readable by every signed-in account. A host
-- could therefore type the address into any of them and defeat PRIV-2A. This function is the server-side test the
-- guards in the next two migrations use. It only reads its arguments; it changes nothing.
--
-- WHAT IT REPORTS (first match wins), NULL when the text is acceptable:
--   map_link    a map or location-sharing link (Google/Apple/Bing/OSM maps, Waze, what3words)
--   coordinates two decimal numbers with 3+ decimals side by side (a latitude/longitude pair)
--   street_address  a house number, up to three words and a street word ("12 Oak St", "1200 N Lake Shore Dr"), or an
--                   ordinal street ("5th Ave"); times, counts and "half court" style phrases are not addresses
--   unit        "apt 4", "suite 200", "unit 3", "bldg 2", "room 12"
--   venue_name  two or more consecutive words of the game's exact venue (the first comma-separated part of the exact
--               location, and any part that contains a digit), ignoring generic words (park, gym, school, court...).
--               A city or state in the exact location is NOT treated as the venue, so "Brooklyn" stays acceptable.
--
-- WHAT IT IS NOT. A heuristic. It cannot catch every paraphrase ("the school on the corner of ..."), which is why moderators
-- also get public.list_youth_games_with_location_text() (next migration) and the host sees a clear message. It errs toward
-- refusing a clear disclosure and accepting an ordinary description of an area.
CREATE OR REPLACE FUNCTION private_sec.location_tokens(_t text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT COALESCE(
    regexp_split_to_array(NULLIF(btrim(regexp_replace(lower(COALESCE(_t, '')), '[^a-z0-9]+', ' ', 'g')), ''), ' '),
    ARRAY[]::text[])
$$;

CREATE OR REPLACE FUNCTION private_sec.text_discloses_location(_text text, _exact_location text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE
  _t     text := COALESCE(_text, '');
  _norm  text;
  _segs  text[];
  _seg   text;
  _toks  text[];
  _i     int;
  _j     int;
  _n     int;
  _stop  text[] := ARRAY['the','a','an','at','of','and','park','court','courts','gym','gymnasium','field','fields',
    'center','centre','school','rec','recreation','community','elementary','middle','high','basketball','soccer',
    'baseball','softball','football','volleyball','tennis','indoor','outdoor','sports','sport','club','church',
    'playground','pool','arena','stadium','complex','hall','academy','st','street','ave','avenue','rd','road','blvd',
    'dr','drive','ln','lane','way','ct','pl','place'];
BEGIN
  IF btrim(_t) = '' THEN RETURN NULL; END IF;

  IF _t ~* '(maps\.google|google\.[a-z.]+/maps|goo\.gl/maps|maps\.app\.goo\.gl|maps\.apple|waze\.com|openstreetmap\.org|bing\.com/maps|w3w\.co|what3words|///[a-z]+\.[a-z]+\.[a-z]+)' THEN
    RETURN 'map_link';
  END IF;
  IF _t ~ '-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}' THEN
    RETURN 'coordinates';
  END IF;
  IF _t ~* '\m\d{1,6}\s+(?!(?:am|pm|a\.m|p\.m|on|at|min|mins|minutes|hour|hours|hr|hrs|v|vs|x|players|people|ppl|spots|teams|games|rounds)\M)(?:[a-z][a-z0-9.''-]*\s+){1,3}(?:st|street|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|ln|lane|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|ct|trl|trail)\M'
     OR _t ~* '\m\d{1,3}(?:st|nd|rd|th)\s+(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane)\M' THEN
    RETURN 'street_address';
  END IF;
  IF _t ~* '\m(?:apt|apartment|suite|ste|unit|bldg|building|room|rm)\.?\s*#?\s*\d+' THEN
    RETURN 'unit';
  END IF;

  IF _exact_location IS NOT NULL AND btrim(_exact_location) <> '' THEN
    _norm := ' ' || array_to_string(private_sec.location_tokens(_t), ' ') || ' ';
    _segs := string_to_array(_exact_location, ',');
    FOR _i IN 1 .. COALESCE(array_length(_segs, 1), 0) LOOP
      _seg := _segs[_i];
      CONTINUE WHEN NOT (_i = 1 OR _seg ~ '\d');          -- later parts without digits are a city or state
      _toks := private_sec.location_tokens(_seg);
      _n := COALESCE(array_length(_toks, 1), 0);
      CONTINUE WHEN _n < 2;                                -- one plain word is not a venue we can recognise
      FOR _j IN 1 .. _n - 1 LOOP
        CONTINUE WHEN _toks[_j] = ANY (_stop) AND _toks[_j + 1] = ANY (_stop);
        CONTINUE WHEN length(_toks[_j]) + length(_toks[_j + 1]) < 5;
        IF position(' ' || _toks[_j] || ' ' || _toks[_j + 1] || ' ' IN _norm) > 0 THEN
          RETURN 'venue_name';
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.location_tokens(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.text_discloses_location(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.location_tokens(text) TO service_role;
GRANT EXECUTE ON FUNCTION private_sec.text_discloses_location(text, text) TO service_role;
