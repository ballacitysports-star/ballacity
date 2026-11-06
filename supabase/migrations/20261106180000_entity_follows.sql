-- Entity follows (backlog P1-1): follow a team, a trainer or a facility.
--
-- `follows` points at accounts (followee_id references auth.users), and its primary key,
-- triggers, notifications and every follower list assume that. Teams and trainers are
-- `teams` rows with text ids; facilities are `trainer_orgs` rows with uuid ids. Instead of
-- making follows.followee_id nullable (which would change its primary key and every reader
-- of it), entity follows get their own small table. Person follows are untouched.
--
-- Rules:
--   * Nobody writes the table directly: follow_entity and unfollow_entity do.
--   * An entity follow needs no approval: it says nothing to the entity about the follower.
--   * The entity must be visible (hidden_at IS NULL) and claimed (owner_id set). An
--     unclaimed listing has nobody behind it to post anything.
--   * An account whose parent has not approved it yet cannot follow (FOLLOW_LOCKED), the
--     same as person follows.
--   * A block between the follower and the entity's owner refuses the follow
--     (FOLLOW_BLOCKED), and blocking removes existing follows of the blocker's entities.
--   * Who follows an entity is private. The follower and their guardian can read the row.
--     The entity's owner only sees a count, through entity_follow_state. An adult running a
--     team never gets a list of the minors who follow it.
--   * The owner cannot follow their own entity.

CREATE TABLE IF NOT EXISTS public.entity_follows (
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('team', 'org')),
  target_id text NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS entity_follows_target_idx
  ON public.entity_follows (target_kind, target_id, created_at DESC);

ALTER TABLE public.entity_follows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.entity_follows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.entity_follows TO authenticated;
GRANT ALL ON public.entity_follows TO service_role;

DROP POLICY IF EXISTS entity_follows_follower_or_guardian_read ON public.entity_follows;
CREATE POLICY entity_follows_follower_or_guardian_read ON public.entity_follows
  FOR SELECT TO authenticated
  USING (follower_id = auth.uid() OR public.is_guardian_of(auth.uid(), follower_id));

-- ------------------------------------------------------------------ the target, resolved
-- Owner and visibility of a followable entity, or no row when it does not exist.
CREATE OR REPLACE FUNCTION private_sec.entity_follow_target(_kind text, _id text)
RETURNS TABLE (owner_id uuid, visible boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _kind = 'team' THEN
    RETURN QUERY SELECT t.owner_id, t.hidden_at IS NULL FROM public.teams t WHERE t.id = _id;
  ELSIF _kind = 'org' AND _id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY SELECT o.owner_id, o.hidden_at IS NULL FROM public.trainer_orgs o WHERE o.id = _id::uuid;
  END IF;
END $$;

REVOKE ALL ON FUNCTION private_sec.entity_follow_target(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.entity_follow_target(text, text) TO service_role;

-- ------------------------------------------------------------------ follow / unfollow
CREATE OR REPLACE FUNCTION public.follow_entity(_kind text, _id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  _owner uuid;
  _visible boolean;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  SELECT t.owner_id, t.visible INTO _owner, _visible
  FROM private_sec.entity_follow_target(_kind, _id) t;
  IF NOT FOUND OR NOT _visible OR _owner IS NULL OR _owner = me THEN
    RAISE EXCEPTION 'INVALID_FOLLOW_TARGET';
  END IF;
  IF public.child_features_locked(me) THEN
    RAISE EXCEPTION 'FOLLOW_LOCKED';
  END IF;
  IF public.blocks_exist_between(me, _owner) THEN
    RAISE EXCEPTION 'FOLLOW_BLOCKED';
  END IF;

  INSERT INTO public.entity_follows (follower_id, target_kind, target_id)
  VALUES (me, _kind, _id)
  ON CONFLICT DO NOTHING;
  RETURN 'following';
END $$;

REVOKE ALL ON FUNCTION public.follow_entity(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.follow_entity(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unfollow_entity(_kind text, _id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  DELETE FROM public.entity_follows
  WHERE follower_id = me AND target_kind = _kind AND target_id = _id;
END $$;

REVOKE ALL ON FUNCTION public.unfollow_entity(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unfollow_entity(text, text) TO authenticated, service_role;

-- Follower count plus whether the caller follows. Counts only, never who. Nothing for an
-- entity the caller cannot see.
CREATE OR REPLACE FUNCTION public.entity_follow_state(_kind text, _id text)
RETURNS TABLE (following boolean, followers integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  _owner uuid;
  _visible boolean;
BEGIN
  SELECT t.owner_id, t.visible INTO _owner, _visible
  FROM private_sec.entity_follow_target(_kind, _id) t;
  IF NOT FOUND OR NOT (_visible OR (me IS NOT NULL AND _owner = me)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    coalesce(bool_or(f.follower_id = me), false),
    count(*)::integer
  FROM public.entity_follows f
  WHERE f.target_kind = _kind AND f.target_id = _id;
END $$;

REVOKE ALL ON FUNCTION public.entity_follow_state(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_follow_state(text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------ cleanup
-- Blocking removes follows of the other person's entities, in both directions.
CREATE OR REPLACE FUNCTION public.remove_entity_follows_on_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.entity_follows f
  WHERE (f.follower_id = NEW.blocked_id AND (
           (f.target_kind = 'team' AND f.target_id IN (SELECT id FROM public.teams WHERE owner_id = NEW.blocker_id))
        OR (f.target_kind = 'org' AND f.target_id IN (SELECT id::text FROM public.trainer_orgs WHERE owner_id = NEW.blocker_id))))
     OR (f.follower_id = NEW.blocker_id AND (
           (f.target_kind = 'team' AND f.target_id IN (SELECT id FROM public.teams WHERE owner_id = NEW.blocked_id))
        OR (f.target_kind = 'org' AND f.target_id IN (SELECT id::text FROM public.trainer_orgs WHERE owner_id = NEW.blocked_id))));
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.remove_entity_follows_on_block() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_entity_follows_on_block() TO service_role;

DROP TRIGGER IF EXISTS user_blocks_cleanup_entity_follows ON public.user_blocks;
CREATE TRIGGER user_blocks_cleanup_entity_follows
AFTER INSERT ON public.user_blocks
FOR EACH ROW EXECUTE FUNCTION public.remove_entity_follows_on_block();

-- No foreign key can point at two tables, so a deleted team or org takes its follows here.
CREATE OR REPLACE FUNCTION public.remove_entity_follows_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.entity_follows
  WHERE target_kind = TG_ARGV[0] AND target_id = OLD.id::text;
  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION public.remove_entity_follows_on_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_entity_follows_on_delete() TO service_role;

DROP TRIGGER IF EXISTS teams_cleanup_entity_follows ON public.teams;
CREATE TRIGGER teams_cleanup_entity_follows
AFTER DELETE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.remove_entity_follows_on_delete('team');

DROP TRIGGER IF EXISTS trainer_orgs_cleanup_entity_follows ON public.trainer_orgs;
CREATE TRIGGER trainer_orgs_cleanup_entity_follows
AFTER DELETE ON public.trainer_orgs
FOR EACH ROW EXECUTE FUNCTION public.remove_entity_follows_on_delete('org');
