-- A team post is never a pickup game.
--
-- A pickup is a game: it is hosted with Host a game and listed in the feed. The
-- app stopped offering "pickup" as a team post kind; this makes the database
-- refuse it too, so a direct API call cannot post one either.
--
-- Any existing pickup post becomes a plain announcement first, so the constraint
-- can be validated and so an old row stays editable and hideable. (There were none
-- when this was written.)

UPDATE public.team_posts SET kind = 'announcement' WHERE kind = 'pickup';

ALTER TABLE public.team_posts DROP CONSTRAINT IF EXISTS team_posts_no_pickup;
ALTER TABLE public.team_posts
  ADD CONSTRAINT team_posts_no_pickup CHECK (kind <> 'pickup');
