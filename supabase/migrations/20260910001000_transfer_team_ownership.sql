-- Hand a team to one of its managers.
--
-- Until now `teams.owner_id` was fixed for the life of the team: the `owner`
-- role is derived from it, `team_set_member_role` refuses to assign or
-- overwrite it, and the client's `canLeave` excludes the owner. An owner who
-- stopped using the app therefore stranded the team permanently — nobody could
-- take it over and the owner could not step down.
--
-- `enforce_single_linked_team` (one team per owner) was dropped in
-- 20260804040157 when `account_profiles` replaced it, so nothing blocks a
-- second owned team any more. The constraint that does bind is
-- `account_profiles_ref_uniq` — UNIQUE (kind, ref_id) — which permits exactly
-- one account profile per team. The row is therefore MOVED to the new owner,
-- never duplicated, and both `profiles.active_profile_id` and
-- `default_profile_id` are repointed off it for the outgoing owner, since they
-- would otherwise reference a profile that now belongs to somebody else.

CREATE OR REPLACE FUNCTION public.transfer_team_ownership(_team text, _to uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _team_name text;
  _kind text;
  _target_role public.team_role;
  _moved uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT name, CASE WHEN kind = 'coach' THEN 'trainer' ELSE 'team' END
    INTO _team_name, _kind
    FROM public.teams WHERE id = _team;
  IF _team_name IS NULL THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;

  -- Only the owner may hand the team on; a manager cannot seize it.
  IF public.team_owner_of(_team) IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'NOT_TEAM_OWNER';
  END IF;
  IF _to = _me THEN RAISE EXCEPTION 'ALREADY_OWNER'; END IF;

  SELECT role INTO _target_role
    FROM public.team_members WHERE team_id = _team AND user_id = _to;
  IF _target_role IS NULL THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
  IF _target_role <> 'manager' THEN RAISE EXCEPTION 'TARGET_NOT_MANAGER'; END IF;

  -- `guard_team_member_role_change` refuses every write to `role = 'owner'`.
  -- This is the one sanctioned path, opened for this transaction only.
  PERFORM set_config('app.team_transfer', 'on', true);

  UPDATE public.teams SET owner_id = _to WHERE id = _team;

  UPDATE public.team_members SET role = 'owner', updated_at = now()
    WHERE team_id = _team AND user_id = _to;
  UPDATE public.team_members SET role = 'manager', updated_at = now()
    WHERE team_id = _team AND user_id = _me;

  UPDATE public.account_profiles SET user_id = _to
    WHERE kind = _kind AND ref_id = _team
    RETURNING id INTO _moved;

  IF _moved IS NOT NULL THEN
    UPDATE public.profiles
       SET active_profile_id = CASE WHEN active_profile_id = _moved
             THEN (SELECT ap.id FROM public.account_profiles ap
                    WHERE ap.user_id = _me AND ap.kind = 'player' LIMIT 1)
             ELSE active_profile_id END,
           default_profile_id = CASE WHEN default_profile_id = _moved
             THEN (SELECT ap.id FROM public.account_profiles ap
                    WHERE ap.user_id = _me AND ap.kind = 'player' LIMIT 1)
             ELSE default_profile_id END
     WHERE id = _me;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES
    (_to, 'team_ownership', 'You now own ' || _team_name,
     'Ownership of ' || _team_name || ' was transferred to you.', '/teams/' || _team),
    (_me, 'team_ownership', 'Ownership transferred',
     'You handed ' || _team_name || ' to a manager. You are now a manager of it.',
     '/teams/' || _team);
END $$;

REVOKE EXECUTE ON FUNCTION public.transfer_team_ownership(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_team_ownership(text, uuid) TO authenticated;
