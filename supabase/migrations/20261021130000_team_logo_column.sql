-- Separate logo column for teams (and coach/trainer profiles, which live in
-- the same table).
--
-- Until now an uploaded logo's URL was stored in `teams.avatar`, the same
-- column that holds a team's initials, so a team could have one or the other.
-- Gyms (trainer_orgs) already keep `avatar` (initials) and `avatar_url` (logo)
-- apart; teams now do too.
--
-- Additive and backward compatible:
--   * `avatar_url` is nullable and length-checked.
--   * Existing logos are COPIED to `avatar_url`; `avatar` is left untouched, so
--     readers that only know `avatar` keep showing the logo. New saves write the
--     initials to `avatar` and the logo URL to `avatar_url`.
-- Safe to run more than once.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS avatar_url text;

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_avatar_url_length;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_avatar_url_length
  CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048);

UPDATE public.teams
   SET avatar_url = avatar
 WHERE avatar_url IS NULL
   AND avatar ~* '^https?://';
