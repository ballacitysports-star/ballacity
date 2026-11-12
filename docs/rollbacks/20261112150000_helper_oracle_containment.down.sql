-- ROLLBACK for supabase/migrations/20261112150000_helper_oracle_containment.sql (SEC-2).
-- NOT a migration. It reopens what the migration closed: every signed-in account can again ask any of the 26 helpers about any other
-- person through the API (is_minor, is_guardian_of, is_team_member, team_role_of, shares_team, blocks_exist_between, can_notify, ...).
-- It puts back the state before the migration:
--   * each public wrapper is dropped and the original function moves back from private_sec to public (ALTER FUNCTION ... SET SCHEMA), with
--     its OID, body, owner, grants and comment, so every policy that calls it is exactly as before;
--   * guard_team_member_role_change, following_feed and following_team_news call the public helpers again, byte for byte as before
--     (md5(pg_get_functiondef) = fb8fb8122c2375050c5491d885c009e2, 2cf9ca78d292411251817fec341d4624, ed69b652a49e1b54f6548a87f708e562);
--   * private_sec.wrap_oracle_helpers() and private_sec.rpc_probe_denied(text, uuid[], name) are dropped.
-- It stops, changing nothing, if a wrapper has been replaced by a real body that was never re-wrapped, or if anything (a policy, say) now
-- depends on a public wrapper: those need a person to look first. No row is written. The app changes that shipped with the migration
-- (can_notify and the payment player check asked with the service role) work either way and stay.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_helper_oracle_containment_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_helper_oracle_containment_rollback=yes")
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_helper_oracle_containment_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets every signed-in account ask whether anyone is a minor, who their guardian is and which teams and games they belong to. Set app.confirm_helper_oracle_containment_rollback=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- The three SECURITY INVOKER functions first, so nothing names private_sec.<helper> once the helpers move back.
CREATE OR REPLACE FUNCTION public.guard_team_member_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid := auth.uid();
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- `transfer_team_ownership` opens this for the length of its own transaction.
  IF coalesce(current_setting('app.team_transfer', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF NEW.role = 'owner' OR OLD.role = 'owner' THEN
    RAISE EXCEPTION 'OWNER_ROLE_FIXED';
  END IF;

  -- coalesce to '' first: a non-member yields NULL, and `NULL NOT IN (...)` is
  -- NULL, which plpgsql treats as false — the check would pass silently.
  IF coalesce(public.team_role_of(NEW.team_id, _me)::text, '') NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'NOT_TEAM_MANAGER';
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.following_feed(_before timestamptz DEFAULT NULL, _limit integer DEFAULT 20)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.posts p
  WHERE auth.uid() IS NOT NULL
    AND p.deleted_at IS NULL
    AND (_before IS NULL OR p.created_at < _before)
    AND (
      (p.posted_as = 'person'
        AND p.author_id IN (SELECT f.followee_id FROM public.follows f WHERE f.follower_id = auth.uid()))
      OR (p.posted_as = 'team'
        AND (p.team_id IN (SELECT ef.target_id FROM public.entity_follows ef
                            WHERE ef.follower_id = auth.uid() AND ef.target_kind = 'team')
             OR public.is_team_member(p.team_id, auth.uid())))
      OR (p.posted_as = 'org'
        AND p.org_id::text IN (SELECT ef.target_id FROM public.entity_follows ef
                                WHERE ef.follower_id = auth.uid() AND ef.target_kind = 'org'))
    )
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.following_team_news(_before timestamptz DEFAULT NULL, _limit integer DEFAULT 20)
RETURNS TABLE (id uuid, team_id text, kind text, title text, body text, image_url text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.id, p.team_id, p.kind, p.title, p.body, p.image_url, p.created_at
  FROM public.team_posts p
  WHERE auth.uid() IS NOT NULL
    AND p.kind IN ('announcement', 'recap')
    AND p.moderation_status = 'approved'
    AND p.hidden_at IS NULL
    AND (_before IS NULL OR p.created_at < _before)
    AND (p.team_id IN (SELECT ef.target_id FROM public.entity_follows ef
                        WHERE ef.follower_id = auth.uid() AND ef.target_kind = 'team')
         OR public.is_team_member(p.team_id, auth.uid()))
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
$$;

-- Wrappers out, originals back. The public signature resolves before the private one moves, so the drop never touches the original.
DO $$
DECLARE
  _sigs text[] := ARRAY[
    'age_verified(uuid)', 'ai_analysis_allowed(uuid)', 'blocks_exist_between(uuid,uuid)', 'can_notify(uuid,uuid)',
    'child_game_participation_allowed(uuid)', 'default_profile_visibility_for(uuid)', 'game_payments_allowed(uuid)',
    'has_entitlement(uuid,text,text)', 'has_role(uuid,public.app_role)', 'is_conversation_participant(uuid,uuid)',
    'is_game_participant(text,uuid)', 'is_guardian_of(uuid,uuid)', 'is_gym_admin_text(text,uuid)', 'is_managed_account(uuid)',
    'is_minor(uuid)', 'is_moderator(uuid)', 'is_org_member(uuid,uuid)', 'is_superadmin(uuid)', 'is_team_manager(text,uuid)',
    'is_team_member(text,uuid)', 'is_trainer_org_admin(uuid,uuid)', 'is_trainer_org_member(uuid,uuid)', 'platform_status(uuid)',
    'shares_team(uuid,uuid)', 'team_role_of(text,uuid)', 'trainer_profile_owned_by(text,uuid)'];
  _sig text; _pub oid; _wrapper boolean;
BEGIN
  FOREACH _sig IN ARRAY _sigs LOOP
    IF to_regprocedure('private_sec.' || _sig) IS NULL THEN
      RAISE EXCEPTION 'rollback: private_sec.% is missing; nothing was changed', _sig;
    END IF;
    _pub := to_regprocedure('public.' || _sig);
    IF _pub IS NOT NULL THEN
      SELECT NOT p.prosecdef AND p.prosrc LIKE '%private_sec.rpc_probe_denied%' INTO _wrapper FROM pg_proc p WHERE p.oid = _pub;
      IF NOT _wrapper THEN
        RAISE EXCEPTION 'rollback: public.% holds a real body that was never re-wrapped; reconcile it with private_sec.% by hand first', _sig, _sig;
      END IF;
      EXECUTE format('DROP FUNCTION public.%s', _sig);                     -- no CASCADE: anything depending on the wrapper stops the rollback
    END IF;
    EXECUTE format('ALTER FUNCTION private_sec.%s SET SCHEMA public', _sig);
  END LOOP;
END $$;

DROP FUNCTION private_sec.wrap_oracle_helpers();
DROP FUNCTION private_sec.rpc_probe_denied(text, uuid[], name);

COMMIT;
