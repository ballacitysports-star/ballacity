-- WP 3.2b (Phase 3): a host's own named lists of regulars ("Tuesday crew"), to invite in one tap.
--
-- WHY. With WP 3.2a a host can invite the people who played in their games in the last 90 days, but every time they pick them
-- one by one from the whole list. A host who runs two different runs keeps two different crews in their head. The owner chose
-- (2026-11-19, "finish all open items and continue", taking the recommended option) a private list kept by the host, not a
-- group players join.
--
-- WHAT.
-- 1. public.host_groups: a host's named list (at most 20 per host, names unique per host, 1 to 60 characters).
-- 2. public.host_group_members: who is on a list (at most 50 per list). Only the host who owns the list reads or changes it; the
--    people on it are not told and cannot see it. A person can be added only while they are one of the host's regulars
--    (private_sec.regular_invitable, WP 3.2a: an adult who played in this host's games in the last 90 days, no block either
--    way, not suspended, not opted out), so a list cannot be used to collect strangers or minors.
-- 3. Nothing about inviting changes: inviting a list goes through game_invite_player one by one, so every rule applies at that
--    moment (a person who later blocks the host, opts out or stops being a regular is refused with the neutral answer).
-- Accounts deleted: their rows go with them (foreign keys ON DELETE CASCADE).
--
-- Rollback: docs/rollbacks/20261124100000_host_groups.down.sql.

CREATE TABLE public.host_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX host_groups_host_name_key ON public.host_groups (host_id, lower(btrim(name)));

CREATE TABLE public.host_group_members (
  group_id uuid NOT NULL REFERENCES public.host_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX host_group_members_user_idx ON public.host_group_members (user_id);

ALTER TABLE public.host_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_group_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_groups, public.host_group_members FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.host_groups TO authenticated;
GRANT UPDATE (name) ON public.host_groups TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.host_group_members TO authenticated;
GRANT ALL ON public.host_groups, public.host_group_members TO service_role;

CREATE OR REPLACE FUNCTION private_sec.owns_host_group(_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.host_groups g WHERE g.id = _group AND g.host_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION private_sec.owns_host_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.owns_host_group(uuid) TO authenticated;

-- "is this person one of MY regulars": the caller's own question only (my_regular_players already answers it), so it is no
-- oracle about anyone else's games
CREATE OR REPLACE FUNCTION private_sec.is_my_regular(_player uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(private_sec.regular_invitable(auth.uid(), _player), false)
$$;
REVOKE ALL ON FUNCTION private_sec.is_my_regular(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.is_my_regular(uuid) TO authenticated;

CREATE POLICY "Hosts read their groups" ON public.host_groups FOR SELECT TO authenticated USING (host_id = auth.uid());
CREATE POLICY "Hosts create their groups" ON public.host_groups FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts rename their groups" ON public.host_groups FOR UPDATE TO authenticated
  USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts delete their groups" ON public.host_groups FOR DELETE TO authenticated USING (host_id = auth.uid());

CREATE POLICY "Hosts read their group members" ON public.host_group_members FOR SELECT TO authenticated
  USING (private_sec.owns_host_group(group_id));
CREATE POLICY "Hosts add their regulars to their groups" ON public.host_group_members FOR INSERT TO authenticated
  WITH CHECK (private_sec.owns_host_group(group_id) AND private_sec.is_my_regular(user_id));
CREATE POLICY "Hosts remove people from their groups" ON public.host_group_members FOR DELETE TO authenticated
  USING (private_sec.owns_host_group(group_id));

-- limits, and the name kept tidy
CREATE OR REPLACE FUNCTION private_sec.host_groups_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'host_groups' THEN
    NEW.name := btrim(NEW.name);
    NEW.updated_at := now();
    IF TG_OP = 'INSERT' AND (SELECT count(*) FROM public.host_groups WHERE host_id = NEW.host_id) >= 20 THEN
      RAISE EXCEPTION 'GROUP_LIMIT: at most 20 groups.' USING ERRCODE = '54000';
    END IF;
  ELSIF (SELECT count(*) FROM public.host_group_members WHERE group_id = NEW.group_id) >= 50 THEN
    RAISE EXCEPTION 'GROUP_LIMIT: at most 50 people in a group.' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.host_groups_limits() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER host_groups_limits BEFORE INSERT OR UPDATE OF name ON public.host_groups
  FOR EACH ROW EXECUTE FUNCTION private_sec.host_groups_limits();
CREATE TRIGGER host_group_members_limits BEFORE INSERT ON public.host_group_members
  FOR EACH ROW EXECUTE FUNCTION private_sec.host_groups_limits();
