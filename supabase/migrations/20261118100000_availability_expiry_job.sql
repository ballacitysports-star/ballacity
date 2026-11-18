-- WP 1.2 (availability-first, Phase 1): posts that have run out are marked expired, and authors of weekly posts are asked
-- "Still available?" before theirs stops being listed.
--
-- WHY. Since WP 1.1 (20261114110000) a post stops being listed to others when it runs out (private_sec.availability_expires_at):
-- dated posts when their last slot ends, weekly and open-ended posts 14 days after the author last confirmed them. Nothing tells the
-- author, and the row keeps status 'open', so My availability has to work the state out for itself and the author only finds out by
-- looking. This adds the server side of the lifecycle the app (WP 1.4) already shows.
--
-- WHAT.
-- 1. private_sec.availability_reminders: one row per post and confirmation, so each confirmation is reminded about once. Not readable
--    or writable by clients; rows go with their post.
-- 2. private_sec.sweep_availability_lifecycle(_now, _limit), SECURITY DEFINER, for the scheduler only:
--    a. Reminder: an open, unhidden, recurring post (any weekly slot, or no slots and no end date) whose run-out time is within three
--       days (REMIND_WITHIN_DAYS in src/lib/availability-lifecycle.ts) gets one in-app notification to its author, type
--       'availability_reconfirm', linking to My availability. Dated posts get none: their end is the end the author chose.
--    b. Expiry: an open post whose run-out time has passed becomes 'expired'. Who can see it does not change (the read policy already
--       hides it); the author sees "Not listed" and can reopen it, which re-stamps last_confirmed_at (WP 1.1's guard).
--    Each post is handled on its own: a legacy row that a validation trigger refuses is skipped and counted, never stops the run.
--    A post whose run-out time cannot be computed (malformed legacy row) is left alone, as the read policy leaves it listed.
--    Returns {"reminded": n, "expired": n, "skipped": n}. At most _limit posts of each kind per run; the rest wait for the next.
-- 3. Job 'sweep-availability-lifecycle', hourly at minute 23, where pg_cron is installed (skipped with a notice otherwise).
--
-- Nothing here changes who can see a post, what a client may write, or any existing row other than an open post that has already
-- run out. In-app only: push for these reminders is a separate step.
--
-- Rollback: docs/rollbacks/20261118100000_availability_expiry_job.down.sql.

-- 1. Reminders sent ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private_sec.availability_reminders (
  availability_id uuid NOT NULL REFERENCES public.player_availabilities(id) ON DELETE CASCADE,
  confirmed_at    timestamptz NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (availability_id, confirmed_at)
);
ALTER TABLE private_sec.availability_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private_sec.availability_reminders FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private_sec.availability_reminders IS
  'WP 1.2: one "Still available?" reminder per post and confirmation (sweep_availability_lifecycle). Not for clients.';

-- 2. The sweep -------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.sweep_availability_lifecycle(_now timestamptz DEFAULT now(), _limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _remind_within constant interval := interval '3 days';
  _cap      integer := greatest(1, least(coalesce(_limit, 500), 5000));
  _reminded integer := 0;
  _expired  integer := 0;
  _skipped  integer := 0;
  _tz       text;
  r         record;
BEGIN
  -- a. "Still available?" for recurring posts about to run out.
  FOR r IN
    SELECT a.id, a.user_id, a.sports, a.timezone, a.last_confirmed_at, x.expires_at
      FROM public.player_availabilities a
      CROSS JOIN LATERAL (SELECT private_sec.availability_expires_at(a.time_slots, a.timezone, a.starts_on, a.ends_on,
                                                                     a.last_confirmed_at) AS expires_at) x
     WHERE a.status = 'open'
       AND a.hidden_at IS NULL
       AND (CASE WHEN jsonb_typeof(a.time_slots) = 'array' AND jsonb_array_length(a.time_slots) > 0
                 THEN EXISTS (SELECT 1 FROM jsonb_array_elements(a.time_slots) s WHERE jsonb_typeof(s) = 'object' AND s ? 'weekday')
                 ELSE a.ends_on IS NULL END)
       AND x.expires_at > _now
       AND x.expires_at <= _now + _remind_within
       AND NOT EXISTS (SELECT 1 FROM private_sec.availability_reminders m
                        WHERE m.availability_id = a.id AND m.confirmed_at = a.last_confirmed_at)
     ORDER BY x.expires_at, a.id
     LIMIT _cap
  LOOP
    BEGIN
      _tz := COALESCE(NULLIF(btrim(r.timezone), ''), 'America/New_York');
      PERFORM now() AT TIME ZONE _tz;
    EXCEPTION WHEN invalid_parameter_value THEN
      _tz := 'America/New_York';
    END;
    BEGIN
      INSERT INTO private_sec.availability_reminders (availability_id, confirmed_at, sent_at)
      VALUES (r.id, r.last_confirmed_at, _now);
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (r.user_id, 'availability_reconfirm', 'Still available to play?',
              'Your weekly ' || COALESCE(lower(NULLIF(r.sports[1], '')) || ' ', '') || 'availability stops being listed on '
                || to_char(r.expires_at AT TIME ZONE _tz, 'Dy, Mon FMDD')
                || '. Tap "Still available" to keep it up.',
              '/players?tab=mine');
      _reminded := _reminded + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL;   -- another run reminded this confirmation first
    END;
  END LOOP;

  -- b. Mark posts that have run out.
  FOR r IN
    SELECT a.id
      FROM public.player_availabilities a
     WHERE a.status = 'open'
       AND private_sec.availability_expires_at(a.time_slots, a.timezone, a.starts_on, a.ends_on, a.last_confirmed_at) <= _now
     ORDER BY a.id
     LIMIT _cap
  LOOP
    BEGIN
      UPDATE public.player_availabilities SET status = 'expired' WHERE id = r.id AND status = 'open';
      IF FOUND THEN _expired := _expired + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      _skipped := _skipped + 1;   -- a legacy row a validation trigger refuses: it stays open and unlisted, as before
    END;
  END LOOP;

  RETURN jsonb_build_object('reminded', _reminded, 'expired', _expired, 'skipped', _skipped);
END $$;
REVOKE ALL ON FUNCTION private_sec.sweep_availability_lifecycle(timestamptz, integer) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private_sec.sweep_availability_lifecycle(timestamptz, integer) IS
  'WP 1.2: reminds authors of recurring posts before they run out and marks run-out posts expired. Scheduler only.';

-- 3. Schedule --------------------------------------------------------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('sweep-availability-lifecycle', '23 * * * *',
      $j$SELECT private_sec.sweep_availability_lifecycle()$j$);
  ELSE
    RAISE NOTICE 'pg_cron is not installed: sweep-availability-lifecycle not scheduled';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'sweep-availability-lifecycle not scheduled: %', SQLERRM;
END
$cron$;
