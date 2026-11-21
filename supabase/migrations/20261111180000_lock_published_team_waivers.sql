-- Lock published team waivers (the "known gap" recorded while writing supabase/tests/810_team_waivers.test.sql).
--
-- What was wrong. drizzle/migrations/0008_team_waivers.sql made a published version immutable with
-- team_waivers_guard, but the guard only looked at OLD.published_at, and the policy team_waivers_manager_update lets a
-- team manager (owner, manager or coach: is_team_manager) UPDATE every column. The API roles hold every table
-- privilege on team_waivers (Supabase's default privileges; row level security is what restricts them). So a manager
-- could, through PostgREST:
--   1. set published_at = NULL on a published waiver, then edit the text people had already signed;
--   2. set published = false and published_at = NULL, then DELETE it (team_waivers_manager_delete_draft only asked for
--      published_at IS NULL), and the delete cascades away its team_waiver_signatures;
--   3. set published = true on a draft directly, skipping publish_team_waiver, which left published_at NULL: the
--      waiver was live for sign_team_waiver and still editable and deletable;
--   and INSERT a draft that already carried published_at or archived_at.
--
-- What changes.
--   a. Column privileges. anon and authenticated lose the table-wide INSERT and UPDATE; authenticated gets back
--      INSERT on (team_id, version, title, content, created_by) and UPDATE on (version, title, content). published,
--      published_at, archived_at, id, created_at and updated_at are written only by publish_team_waiver (SECURITY
--      DEFINER, unchanged), the triggers, or the server's service role; team_id and created_by are set once, on
--      INSERT, where team_waivers_manager_insert still checks them. An upsert (INSERT ... ON CONFLICT DO UPDATE) needs
--      the same column privileges, so it reaches no further. Nothing else writes the table: no view, no SECURITY
--      INVOKER function, no trigger on another table (checked in the migrations and in the replayed catalog); the
--      foreign keys' ON DELETE actions (team deleted, creator's account deleted) run as the table owner, and the
--      guard lets the creator's SET NULL through.
--   b. team_waivers_guard (same name, signature, SECURITY DEFINER and search_path) locks a version's text and team
--      once it has been published, whether or not it still is: it has a published_at, is published, has been retired
--      (archived_at) or has been signed. The last three also hold a row whose stamp was cleared, or never set, before
--      this migration: a retired version without a published_at, an unpublished one that people signed, and a row
--      flagged published without a stamp, including once publish_team_waiver retires it. The guard also refuses
--      clearing or changing published_at once it is set, and refuses turning a row published without a published_at.
--      It applies to every caller on UPDATE, the service role included, so 1 and 3 stay closed even if a broad GRANT
--      ever gives the table-wide UPDATE back. It still sets updated_at. It does not run on INSERT: the API roles can
--      no longer insert published, published_at or archived_at, but the service role could still insert a row
--      flagged published without a stamp (no server code inserts waivers).
--   c. team_waivers_manager_delete_draft also asks for NOT published, no archived_at and no signature, so a manager
--      deletes only a draft that was never published, retired or signed. Those are the only rows the app deletes. The
--      signature check reads team_waiver_signatures under the manager's row level security, which shows them every
--      signature carrying their team; every signature carries its waiver's team (sign_team_waiver, register_for_event
--      and rsvp_tryout write it so), and after this migration neither side's team can change for a signed version.
--
-- Not changed (an owner question): deleting a whole team still cascades its waivers and their signatures away
-- (team_waivers.team_id and team_waiver_signatures.team_id are ON DELETE CASCADE). The team's owner can do that
-- (policy "Owners can delete their teams", or the app's deleteTeam), and so does purging the owner's account
-- (teams.owner_id is ON DELETE CASCADE). A manager who is not the owner cannot.
--
-- What does not change for the app (src/lib/team-waivers.ts). It INSERTs team_id, version, title, content and
-- created_by; UPDATEs version, title and content of a draft (.is('published_at', null)); DELETEs a draft
-- (.is('published_at', null)); publishes and re-publishes through publish_team_waiver, which retires the previous
-- version (published = false, archived_at = now(), published_at kept) and keeps a re-published version's first
-- published_at; and signs through sign_team_waiver. All of these still work (810 asserts each). The server reads the
-- table with the service role. publish_team_waiver, sign_team_waiver, the read, insert and update policies and the
-- touch_updated_at trigger are unchanged. No E2E spec writes waivers.
--
-- Production (read-only, 2026-11-11): 2 waivers, 1 published, 4 signatures; no published row without published_at;
-- no unpublished row with a published_at that is not archived. Before applying, this must also return 0 (a row it
-- counts would become locked, not deletable): SELECT count(*) FROM public.team_waivers w WHERE w.published_at IS NULL
-- AND (w.published OR w.archived_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.team_waiver_signatures s WHERE
-- s.waiver_id = w.id)); and so must the count of signatures whose team_id differs from their waiver's.
-- Before: md5(pg_get_functiondef('public.team_waivers_guard()')) = b88e201fe1bf0c36c187da1b17436e86; anon and
-- authenticated hold DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on the table and no column grant.
--
-- Everything here tightens: no rule is loosened and no row is written.
-- ROLLBACK: docs/rollbacks/20261111180000_lock_published_team_waivers.down.sql (guarded).
-- TEST: supabase/tests/810_team_waivers.test.sql.

SET lock_timeout = '5s';

-- ============================================================ a. column privileges
-- Revoking a table-wide privilege also clears any column grant of it, so the GRANTs below are the whole set.
REVOKE INSERT, UPDATE ON public.team_waivers FROM anon, authenticated;
GRANT INSERT (team_id, version, title, content, created_by) ON public.team_waivers TO authenticated;
GRANT UPDATE (version, title, content) ON public.team_waivers TO authenticated;

-- ============================================================ b. the guard
CREATE OR REPLACE FUNCTION public.team_waivers_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Locked once published, whether or not it still is: a retired version keeps its published_at, and a version
  -- whose stamp was cleared before the lock is still retired (archived_at) or signed.
  IF NEW.content <> OLD.content OR NEW.version <> OLD.version OR NEW.title <> OLD.title
     OR NEW.team_id <> OLD.team_id THEN
    IF OLD.published_at IS NOT NULL OR OLD.published OR OLD.archived_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.team_waiver_signatures s WHERE s.waiver_id = OLD.id) THEN
      RAISE EXCEPTION 'Published waiver versions are immutable; create a new version instead';
    END IF;
  END IF;
  -- Clearing the stamp would turn a signed version back into an editable, deletable draft.
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'A published waiver keeps its published_at; it cannot be cleared or changed';
  END IF;
  -- publish_team_waiver sets published and published_at together.
  IF NEW.published AND NOT OLD.published AND NEW.published_at IS NULL THEN
    RAISE EXCEPTION 'A waiver cannot be published without a published_at; publish it with publish_team_waiver';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ============================================================ c. delete: drafts that were never published
ALTER POLICY "team_waivers_manager_delete_draft" ON public.team_waivers
  USING (
    public.is_team_manager(team_id, auth.uid())
    AND published_at IS NULL AND NOT published AND archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.team_waiver_signatures s WHERE s.waiver_id = team_waivers.id)
  );
