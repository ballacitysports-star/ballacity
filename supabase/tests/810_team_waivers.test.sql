-- Team waivers (drizzle/migrations/0008_team_waivers.sql, locked by 20261111180000_lock_published_team_waivers): the
-- W1-W14 checks from the stale PR #27's verification doc (docs/guardian-team-approvals-verification.md on
-- claude/guardian-team-approvals), run against main, plus the lock (L1-L9) and the rest of the app's flows (W15-W17).
-- Managers (owner, manager, coach) write drafts that only they see, publish them through publish_team_waiver, and a
-- published version cannot be edited in place, moved or deleted; one published version per team. Members and
-- pending invitees of that team sign through sign_team_waiver only, once each, and only its published waiver.
--
-- The lock. The API roles write only a draft's text: authenticated may INSERT team_id, version, title, content and
-- created_by, and UPDATE version, title and content ("permission denied for table team_waivers" for any other
-- column); anon writes nothing. published, published_at and archived_at move only through publish_team_waiver (or
-- the server). team_waivers_guard locks a version's text and team once it has a published_at, is published, has
-- been retired (archived_at) or has been signed; keeps published_at once set; and refuses a published flag without
-- one; on UPDATE, for every caller, the server included. A manager deletes only a draft that was never published,
-- retired or signed, so no manager deletes a signed version or its signatures (deleting the whole team still
-- cascades them away: an owner question, not tested here). L1-L7 run each bypass step as the owner, a manager and a
-- coach; L8 shows the guard holds for the server too and, with the delete policy, still holds if the table-wide
-- UPDATE is ever granted back; L9 plants the rows the old bypasses could leave behind (flagged published without a
-- stamp, also once retired; retired without a stamp; signed without a stamp) and shows each stays locked and
-- undeletable for the owner and a coach. Every legitimate flow the app has stays asserted: create a draft (W1),
-- edit its text (W15), delete it (W16), publish through the function (W3), publish v2 to retire v1 (W5), re-publish
-- a retired version (W17), sign (W7, W12, W17). A refusal pins its text: "permission denied for table team_waivers"
-- (a column privilege) or the guard's own message.
--
-- Not here, on purpose:
--   * W10 (a guardian signs for their child with the attestation, signed_by = the guardian). Who may sign a
--     team waiver for a minor (the guardian, the minor themself, nobody through this function) is an owner
--     question, so this file asserts no success case of signing for or as a minor. W9 stays because it is a
--     refusal whoever turns out to be allowed: nothing is signed on a child's behalf without the attestation.
--     For the record, sign_team_waiver has no age check, so today a minor member signs for themself (not asserted).
--   * Joining past an unsigned waiver (WAIVER_REQUIRED on team_respond_invite and guardian_approve_team_invite):
--     30_guardian_gates.test.sql. Event sign-ups that sign the waiver: 630_events_stage1 and 710.
BEGIN;

SELECT t.person('owner', 40), t.person('manager', 38), t.person('coach', 36), t.person('member', 30),
       t.person('invitee', 26), t.person('declined', 27), t.person('stranger', 29), t.person('guardian', 44),
       t.person('teen', 14), t.person('elsewhere', 31);
SELECT t.guardian('guardian', 'teen');
SELECT t.team('squad', 'owner');
SELECT t.team('other', 'stranger');
SELECT t.team('annex', 'owner'); -- a second team the owner manages, so a move between them passes row level security
SELECT t.member('squad', 'manager', 'manager');
SELECT t.member('squad', 'coach', 'coach');
SELECT t.member('squad', 'member', 'player');
SELECT t.member('squad', 'teen', 'player');
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by) VALUES
  (t.id('invite-pending'), 'squad', t.id('invitee'), t.id('owner')),
  (t.id('invite-declined'), 'squad', t.id('declined'), t.id('owner'));
UPDATE public.team_invites SET status = 'declined', responded_at = now() WHERE id = t.id('invite-declined');
-- A pending invite, but to another team: it does not make them an invitee of squad.
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by) VALUES
  (t.id('invite-elsewhere'), 'other', t.id('elsewhere'), t.id('stranger'));

-- The app inserts a waiver without an id (the API roles may not choose one), so a squad version's id is looked up.
-- As the definer, so row level security does not hide a draft from whoever the check runs as.
CREATE FUNCTION t.waiver(_version text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT id FROM public.team_waivers WHERE team_id = 'squad' AND version = _version
$f$;

-- t.throws, except that a statement that wrongly succeeds is undone, so one open hole does not change the rows
-- the later checks read. Run against the rollback, every lock check fails (W1 x3, the W4 move, the W6 flag, L1-L9),
-- while the refusals that predate the lock (the old guard's "immutable" in W4, W5, L6, L8 and W17, and W6's unique
-- index for the server) still pass, and so do the legitimate flows.
CREATE FUNCTION t.refused(stmt text, pattern text, name text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'the statement succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'T0001' THEN
      RAISE NOTICE 'not ok - % (no error was raised; the change was undone)', name;
    ELSIF SQLERRM ILIKE '%' || pattern || '%' THEN
      RAISE NOTICE 'ok - %', name;
    ELSE
      RAISE NOTICE 'not ok - % (raised "%", wanted "%")', name, replace(SQLERRM, E'\n', ' '), pattern;
    END IF;
  END;
END $f$;

-- How many rows a statement would change for the current role; the change is then undone.
CREATE FUNCTION t.would_change(stmt text) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = n::text;
  EXCEPTION
    WHEN insufficient_privilege THEN RETURN 0;
    WHEN SQLSTATE 'T0001' THEN RETURN SQLERRM::int;
  END;
END $f$;

-- ---- W1: a manager creates a draft ---------------------------------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (team_id, version, title, content, created_by)
    VALUES ('squad', 'v1', 'Squad waiver', 'Version one terms.', %L)$$, t.id('manager')),
  'W1: a manager creates a draft, writing the columns the app writes');
SELECT t.refused(format($$INSERT INTO public.team_waivers (team_id, version, content, published, published_at, created_by)
    VALUES ('squad', 'v0', 'Straight to published.', true, now(), %L)$$, t.id('manager')),
  'permission denied for table team_waivers', 'W1: a draft cannot be inserted already published');
SELECT t.refused(format($$INSERT INTO public.team_waivers (id, team_id, version, content, created_by)
    VALUES (%L, 'squad', 'v0', 'My own id.', %L)$$, t.id('w-chosen'), t.id('manager')),
  'permission denied for table team_waivers', 'W1: nor with an id of the caller''s choosing');
SELECT t.reset();
SELECT t.as_user(t.id('member'));
SELECT t.throws(format($$INSERT INTO public.team_waivers (team_id, version, content, created_by)
    VALUES ('squad', 'vx', 'A player''s waiver.', %L)$$, t.id('member')),
  'row-level security', 'W1: a player cannot create a waiver');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.refused($$INSERT INTO public.team_waivers (team_id, version, content) VALUES ('squad', 'va', 'Anonymous.')$$,
  'permission denied for table team_waivers', 'W1: nor can a signed-out visitor (no write privilege at all)');
SELECT t.reset();
SELECT t.eq((SELECT published::text || ':' || (published_at IS NULL)::text || ':' || (archived_at IS NULL)::text
  FROM public.team_waivers WHERE id = t.waiver('v1')), 'false:true:true', 'W1: the draft is stored unpublished');

-- ---- W2: a draft is the managers' alone ----------------------------------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.waiver('v1'))), 0,
  'W2: a member does not see the draft');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.waiver('v1'))), 0,
  'W2: nor does a stranger');
SELECT t.reset();
SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.waiver('v1'))), 1,
  'W2: the team owner (a manager) does');
SELECT t.reset();

-- ---- W3: a manager publishes it ------------------------------------------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.throws(format('SELECT public.publish_team_waiver(%L)', t.waiver('v1')), 'NOT_TEAM_MANAGER',
  'W3: a member cannot publish');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.publish_team_waiver(%L)', t.waiver('v1')), 'NOT_TEAM_MANAGER',
  'W3: nor a stranger');
SELECT t.reset();
SELECT t.as_user(t.id('manager'));
SELECT t.eq(public.publish_team_waiver(t.waiver('v1')), t.waiver('v1'), 'W3: a manager publishes the draft');
SELECT t.reset();
SELECT t.eq((SELECT published::text || ':' || (published_at IS NOT NULL)::text FROM public.team_waivers WHERE id = t.waiver('v1')),
  'true:true', 'W3: it is published, with a published_at');
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.waiver('v1'))), 1,
  'W3: members now see it');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.team_waivers'), 0, 'signed-out visitors see no waiver');
SELECT t.reset();

-- ---- W4: a published version cannot be edited ----------------------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.refused(format($$UPDATE public.team_waivers SET content = 'Quietly changed.' WHERE id = %L$$, t.waiver('v1')),
  'immutable', 'W4: a published waiver''s content cannot be edited');
SELECT t.refused(format($$UPDATE public.team_waivers SET title = 'Renamed' WHERE id = %L$$, t.waiver('v1')),
  'immutable', 'W4: nor its title');
SELECT t.refused(format($$UPDATE public.team_waivers SET version = 'v1b' WHERE id = %L$$, t.waiver('v1')),
  'immutable', 'W4: nor its version');
SELECT t.reset();
SELECT t.as_user(t.id('owner'));
SELECT t.refused(format($$UPDATE public.team_waivers SET team_id = 'annex' WHERE id = %L$$, t.waiver('v1')),
  'permission denied for table team_waivers', 'W4: nor moved to another team the same person manages');
SELECT t.reset();
SELECT t.as_service();
SELECT t.refused(format($$UPDATE public.team_waivers SET team_id = 'annex' WHERE id = %L$$, t.waiver('v1')),
  'immutable', 'W4: not even by the server (the guard)');
SELECT t.reset();
SELECT t.eq((SELECT team_id || ':' || content FROM public.team_waivers WHERE id = t.waiver('v1')), 'squad:Version one terms.',
  'W4: the published text is unchanged, on the same team');

-- ---- W7, W8: an adult member signs for themself, once --------------------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.ok(public.sign_team_waiver('squad', t.waiver('v1')) IS NOT NULL, 'W7: an adult member signs for themself');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id = t.waiver('v1') AND signer_user_id = t.id('member')),
  1, 'W7: one signature');
SELECT t.ok((SELECT signed_by IS NULL FROM public.team_waiver_signatures WHERE waiver_id = t.waiver('v1') AND signer_user_id = t.id('member')),
  'W7: signed for themself (signed_by empty)');
SELECT t.as_user(t.id('member'));
SELECT t.lives(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v1')), 'W8: signing again is not an error');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id = t.waiver('v1') AND signer_user_id = t.id('member')),
  1, 'W8: still one signature');

-- ---- W5: publishing v2 retires v1 ----------------------------------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (team_id, version, title, content, created_by)
    VALUES ('squad', 'v2', 'Squad waiver', 'Version two terms.', %L)$$, t.id('manager')),
  'W5: a manager drafts v2');
SELECT t.eq(public.publish_team_waiver(t.waiver('v2')), t.waiver('v2'), 'W5: and publishes it');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(version || '=' || published::text || ':' || (archived_at IS NOT NULL)::text || ':'
    || (published_at IS NOT NULL)::text, ',' ORDER BY version)
  FROM public.team_waivers WHERE team_id = 'squad'), 'v1=false:true:true,v2=true:false:true',
  'W5: v1 is unpublished and archived (keeping its published_at), v2 is the published one');
SELECT t.as_user(t.id('manager'));
SELECT t.refused(format($$UPDATE public.team_waivers SET content = 'Rewrite history.' WHERE id = %L$$, t.waiver('v1')),
  'immutable', 'W5: a retired version stays immutable');
SELECT t.reset();

-- ---- W6: one published version per team, even writing the rows directly -------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.refused(format('UPDATE public.team_waivers SET published = true WHERE id = %L', t.waiver('v1')),
  'permission denied for table team_waivers', 'W6: a manager cannot set the published flag directly');
SELECT t.reset();
SELECT t.as_service();
SELECT t.refused(format('UPDATE public.team_waivers SET published = true WHERE id = %L', t.waiver('v1')),
  'team_waivers_one_published_per_team', 'W6: and a second published version is refused by the unique index');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waivers WHERE team_id = 'squad' AND published), 1,
  'W6: the team still has exactly one published waiver');

-- ---- W9: nothing is signed on a child's behalf without the attestation ---------------------------------------
-- A refusal only. Whether anyone may sign for a minor (W10's success case) is the owner's question; see the top.
SELECT t.as_user(t.id('guardian'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L, %L, false)$$, t.waiver('v2'), t.id('teen')),
  'ATTESTATION_REQUIRED', 'W9: signing for a child without the attestation is refused');
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L, %L)$$, t.waiver('v2'), t.id('teen')),
  'ATTESTATION_REQUIRED', 'W9: and the attestation is not assumed when left out');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L, %L, true)$$, t.waiver('v2'), t.id('teen')),
  'NOT_YOUR_GUARDIAN_LINK', 'W9: someone with no guardian link cannot sign for the child, attestation or not');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE signer_user_id = t.id('teen')), 0,
  'W9: no signature exists for the child');

-- ---- W11, W12: who can sign for themself ---------------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v2')), 'NOT_TEAM_MEMBER_OR_INVITEE',
  'W11: a stranger (not a member, not invited) cannot sign');
SELECT t.reset();
SELECT t.as_user(t.id('declined'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v2')), 'NOT_TEAM_MEMBER_OR_INVITEE',
  'W11: nor someone whose invite was declined');
SELECT t.reset();
SELECT t.as_user(t.id('elsewhere'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v2')), 'NOT_TEAM_MEMBER_OR_INVITEE',
  'W11: nor someone whose pending invite is to another team');
SELECT t.reset();
SELECT t.as_user(t.id('invitee'));
SELECT t.ok(public.sign_team_waiver('squad', t.waiver('v2')) IS NOT NULL, 'W12: an adult with a pending invite signs');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id = t.waiver('v2') AND signer_user_id = t.id('invitee')),
  1, 'W12: one signature for the invitee');
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures
  WHERE signer_user_id IN (t.id('stranger'), t.id('declined'), t.id('elsewhere'))), 0,
  'W11: none for the stranger, the declined invitee or the one invited elsewhere');

-- ---- W13: signatures are written through sign_team_waiver only -----------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.throws(format($$INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id)
    VALUES (%L, 'squad', %L)$$, t.waiver('v2'), t.id('member')),
  'row-level security', 'W13: a member cannot insert their own signature row');
SELECT t.eq(t.changed(format('UPDATE public.team_waiver_signatures SET signed_by = %L WHERE signer_user_id = %L',
    t.id('guardian'), t.id('member'))), 0, 'W13: nor rewrite their signature');
SELECT t.eq(t.changed(format('DELETE FROM public.team_waiver_signatures WHERE signer_user_id = %L', t.id('member'))), 0,
  'W13: nor delete it');
SELECT t.reset();
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format($$INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by)
    VALUES (%L, 'squad', %L, %L)$$, t.waiver('v2'), t.id('teen'), t.id('guardian')),
  'row-level security', 'W13: a manager cannot write a signature for someone');
SELECT t.eq(t.changed(format('DELETE FROM public.team_waiver_signatures WHERE team_id = %L', 'squad')), 0,
  'W13: nor delete the team''s signatures');
SELECT t.eq(t.would_change(format('DELETE FROM public.team_waivers WHERE id = %L', t.waiver('v2'))), 0,
  'W13: nor delete the current published version (which would take its signatures with it)');
SELECT t.eq(t.would_change(format('DELETE FROM public.team_waivers WHERE id = %L', t.waiver('v1'))), 0,
  'W13: nor delete a retired version');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE team_id = 'squad'), 2,
  'W13: both signatures are still there');

-- ---- W14: only the team's published waiver can be signed ----------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (team_id, version, title, content, created_by)
    VALUES ('squad', 'v3', 'Squad waiver', 'Version three draft.', %L)$$, t.id('manager')),
  'W14: a manager drafts v3');
SELECT t.reset();
INSERT INTO public.team_waivers (id, team_id, version, title, content, published, published_at, created_by)
VALUES (t.id('w-other'), 'other', 'v1', 'Other waiver', 'Another team''s terms.', true, now(), t.id('stranger'));
SELECT t.as_user(t.id('member'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v3')), 'WAIVER_NOT_PUBLISHED',
  'W14: a draft cannot be signed');
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v1')), 'WAIVER_NOT_PUBLISHED',
  'W14: nor a retired version');
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-other')), 'WAIVER_NOT_PUBLISHED',
  'W14: nor another team''s waiver named against this team');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v2')), 'permission denied',
  'signed-out visitors cannot call sign_team_waiver');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id IN (t.waiver('v3'), t.id('w-other'))), 0,
  'W14: nothing was signed');

-- ---- L1-L7: no manager gets around the lock, step by step (the owner, a manager and a coach) ----------------
-- v1 is retired and signed by the member, v2 is published and signed by the invitee, v3 is a draft. Each step a
-- manager could send through PostgREST, in the order the bypass needs them; a refused step changes nothing.
CREATE TEMP TABLE squad_before ON COMMIT DROP AS
  SELECT id, team_id, version, title, content, published, published_at, archived_at, created_by
    FROM public.team_waivers WHERE team_id = 'squad';
CREATE FUNCTION t.squad_differs() RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM (
    (SELECT id, team_id, version, title, content, published, published_at, archived_at, created_by
       FROM public.team_waivers WHERE team_id = 'squad'
     EXCEPT SELECT * FROM squad_before)
    UNION ALL
    (SELECT * FROM squad_before
     EXCEPT SELECT id, team_id, version, title, content, published, published_at, archived_at, created_by
       FROM public.team_waivers)
  ) d
$f$;

-- The whole bypass as a manager would chain it: each step is tried (a refused one is skipped), then the DELETE.
-- Answers "rows deleted:signatures left on the waiver", and everything is then undone.
CREATE FUNCTION t.bypass_then_delete(_id uuid) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  BEGIN
    BEGIN
      EXECUTE format('UPDATE public.team_waivers SET published = false, published_at = NULL, archived_at = NULL WHERE id = %L', _id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      EXECUTE format('UPDATE public.team_waivers SET published_at = NULL WHERE id = %L', _id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    EXECUTE format('DELETE FROM public.team_waivers WHERE id = %L', _id);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'T0001',
      MESSAGE = n || ':' || (SELECT count(*) FROM public.team_waiver_signatures WHERE waiver_id = _id);
  EXCEPTION WHEN SQLSTATE 'T0001' THEN
    RETURN SQLERRM;
  END;
END $f$;

CREATE FUNCTION t.cannot_bypass(who text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  denied constant text := 'permission denied for table team_waivers';
  v1 constant uuid := t.waiver('v1');
  v2 constant uuid := t.waiver('v2');
  v3 constant uuid := t.waiver('v3');
BEGIN
  PERFORM t.as_user(t.id(who));
  -- L1: clear the stamp, the first step of every bypass.
  PERFORM t.refused(format('UPDATE public.team_waivers SET published_at = NULL WHERE id = %L', v2), denied,
    format('L1 (%s): cannot clear published_at on the published version', who));
  PERFORM t.refused(format('UPDATE public.team_waivers SET published_at = NULL WHERE id = %L', v1), denied,
    format('L1 (%s): nor on a retired version', who));
  -- L2: unpublish or archive without publishing another version.
  PERFORM t.refused(format('UPDATE public.team_waivers SET published = false WHERE id = %L', v2), denied,
    format('L2 (%s): cannot unpublish the published version directly', who));
  PERFORM t.refused(format('UPDATE public.team_waivers SET archived_at = now() WHERE id = %L', v2), denied,
    format('L2 (%s): nor archive it directly', who));
  PERFORM t.refused(format('UPDATE public.team_waivers SET published = false, published_at = NULL, archived_at = NULL WHERE id = %L', v2),
    denied, format('L2 (%s): nor turn it back into a draft in one statement', who));
  -- L3: publish without publish_team_waiver.
  PERFORM t.refused(format('UPDATE public.team_waivers SET published = true WHERE id = %L', v3), denied,
    format('L3 (%s): cannot publish a draft directly', who));
  PERFORM t.refused(format('UPDATE public.team_waivers SET published_at = now() WHERE id = %L', v3), denied,
    format('L3 (%s): nor stamp a draft published_at', who));
  -- L4: the columns set once, on INSERT.
  PERFORM t.refused(format($$UPDATE public.team_waivers SET team_id = 'annex' WHERE id = %L$$, v3), denied,
    format('L4 (%s): cannot move a draft to another team', who));
  PERFORM t.refused(format('UPDATE public.team_waivers SET created_by = %L WHERE id = %L', t.id(who), v2), denied,
    format('L4 (%s): cannot change who created a version', who));
  PERFORM t.refused(format('UPDATE public.team_waivers SET id = %L WHERE id = %L', t.id('w-rekeyed'), v3), denied,
    format('L4 (%s): cannot change a version''s id', who));
  -- L5: a new row that claims to be published, or retired.
  PERFORM t.refused(format($$INSERT INTO public.team_waivers (team_id, version, content, created_by, published)
      VALUES ('squad', 'x1', 'Born published.', %L, true)$$, t.id(who)), denied,
    format('L5 (%s): cannot insert a row carrying published', who));
  PERFORM t.refused(format($$INSERT INTO public.team_waivers (team_id, version, content, created_by, published_at)
      VALUES ('squad', 'x2', 'Born stamped.', %L, now())$$, t.id(who)), denied,
    format('L5 (%s): nor one carrying published_at', who));
  PERFORM t.refused(format($$INSERT INTO public.team_waivers (team_id, version, content, created_by, archived_at)
      VALUES ('squad', 'x3', 'Born retired.', %L, now())$$, t.id(who)), denied,
    format('L5 (%s): nor one carrying archived_at', who));
  -- L6: an upsert reaches no further than INSERT and UPDATE.
  PERFORM t.refused(format($$INSERT INTO public.team_waivers (team_id, version, content, created_by)
      VALUES ('squad', 'v2', 'Upserted rewrite.', %L) ON CONFLICT (team_id, version) DO UPDATE SET content = EXCLUDED.content$$,
      t.id(who)), 'immutable', format('L6 (%s): an upsert cannot rewrite the published text', who));
  PERFORM t.refused(format($$INSERT INTO public.team_waivers (team_id, version, content, created_by)
      VALUES ('squad', 'v2', 'Upserted.', %L) ON CONFLICT (team_id, version) DO UPDATE SET published_at = NULL$$,
      t.id(who)), denied, format('L6 (%s): nor clear its published_at', who));
  -- L7: the steps chained, then DELETE: neither signed version goes, nor its signature.
  PERFORM t.eq(t.bypass_then_delete(v2), '0:1',
    format('L7 (%s): the published version cannot be deleted, even after the bypass steps; its signature stays', who));
  PERFORM t.eq(t.bypass_then_delete(v1), '0:1',
    format('L7 (%s): nor the retired one', who));
  PERFORM t.reset();
END $f$;

SELECT t.cannot_bypass('owner');
SELECT t.cannot_bypass('manager');
SELECT t.cannot_bypass('coach');
SELECT t.as_anon();
SELECT t.refused(format('UPDATE public.team_waivers SET published_at = NULL WHERE id = %L', t.waiver('v2')),
  'permission denied for table team_waivers', 'L1 (signed out): a visitor cannot update a waiver at all');
SELECT t.reset();
SELECT t.eq(t.squad_differs(), 0, 'L1-L7: every squad version is exactly as it was (flags, stamps, text, team, author)');
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE team_id = 'squad'), 2,
  'L7: both signatures survive');

-- ---- L8: the guard holds for every caller, and without the column privileges ---------------------------------
SELECT t.as_service();
SELECT t.refused(format('UPDATE public.team_waivers SET published_at = NULL WHERE id = %L', t.waiver('v2')),
  'keeps its published_at', 'L8: even the server cannot clear a published_at');
SELECT t.refused(format($$UPDATE public.team_waivers SET published_at = published_at - interval '1 day' WHERE id = %L$$,
    t.waiver('v1')),
  'keeps its published_at', 'L8: nor change a retired version''s');
SELECT t.refused(format('UPDATE public.team_waivers SET published = true WHERE id = %L', t.waiver('v3')),
  'without a published_at', 'L8: nor flag a draft published without a published_at');
SELECT t.reset();
-- As if a broad GRANT ever gave the API roles the table-wide UPDATE back: undone below.
SAVEPOINT regrant;
GRANT UPDATE ON public.team_waivers TO authenticated;
SELECT t.as_user(t.id('manager'));
SELECT t.refused(format('UPDATE public.team_waivers SET published_at = NULL WHERE id = %L', t.waiver('v2')),
  'keeps its published_at', 'L8 (table-wide UPDATE): the guard still keeps published_at');
SELECT t.refused(format('UPDATE public.team_waivers SET published = true WHERE id = %L', t.waiver('v3')),
  'without a published_at', 'L8 (table-wide UPDATE): a draft still cannot be flagged published without a stamp');
SELECT t.lives(format('UPDATE public.team_waivers SET published = false WHERE id = %L', t.waiver('v2')),
  'L8 (table-wide UPDATE): a manager could unflag the published version');
SELECT t.refused(format($$UPDATE public.team_waivers SET content = 'Now a draft?' WHERE id = %L$$, t.waiver('v2')),
  'immutable', 'L8 (table-wide UPDATE): but it keeps its stamp, so its text stays locked');
SELECT t.eq(t.would_change(format('DELETE FROM public.team_waivers WHERE id = %L', t.waiver('v2'))), 0,
  'L8 (table-wide UPDATE): and it still cannot be deleted');
SELECT t.reset();
ROLLBACK TO SAVEPOINT regrant;
SELECT t.eq(t.squad_differs(), 0, 'L8: the grant and the unflagging were undone');

-- ---- L9: rows the old bypasses could leave behind stay locked (planted as the superuser, on annex) -------------
-- Only possible before the lock: flagged published with no stamp (bypass 3), retired with its stamp cleared (bypass
-- 1 on a retired version; no signature, so archived_at alone holds it) and unpublished with its stamp cleared but
-- signed (bypass 2 without the DELETE; signed, so its signature alone holds it).
SELECT t.member('annex', 'coach', 'coach');
INSERT INTO public.team_waivers (id, team_id, version, title, content, published, published_at, archived_at, created_by)
VALUES
  (t.id('w-unstamped'), 'annex', 'v1', 'Annex waiver', 'Published the old way.', true, NULL, NULL, t.id('owner')),
  (t.id('w-retired-unstamped'), 'annex', 'v0', 'Annex waiver', 'Retired, stamp cleared.', false, NULL, now(), t.id('owner')),
  (t.id('w-signed-unstamped'), 'annex', 'v0b', 'Annex waiver', 'Signed, stamp cleared.', false, NULL, NULL, t.id('owner'));
INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id)
VALUES (t.id('w-signed-unstamped'), 'annex', t.id('owner'));
SELECT t.as_user(t.id('owner'));
SELECT t.ok(public.sign_team_waiver('annex', t.id('w-unstamped')) IS NOT NULL,
  'L9: the owner signs the row flagged published without a stamp (sign_team_waiver accepts it)');
SELECT t.reset();
CREATE TEMP TABLE annex_before ON COMMIT DROP AS
  SELECT id, version, title, content FROM public.team_waivers WHERE team_id = 'annex';

-- A planted row's text cannot be edited, nor can the row be deleted (as the owner and as a coach).
CREATE FUNCTION t.legacy_locked(who text, _id uuid, what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.as_user(t.id(who));
  PERFORM t.refused(format($$UPDATE public.team_waivers SET content = 'Edited after signing.' WHERE id = %L$$, _id),
    'immutable', format('L9 (%s): %s: its text cannot be edited', who, what));
  PERFORM t.eq(t.would_change(format('DELETE FROM public.team_waivers WHERE id = %L', _id)), 0,
    format('L9 (%s): %s: nor can it be deleted', who, what));
  PERFORM t.reset();
END $f$;
SELECT t.legacy_locked(who, t.id('w-unstamped'), 'flagged published without a stamp')
  FROM unnest(ARRAY['owner', 'coach']) who;
SELECT t.legacy_locked(who, t.id('w-retired-unstamped'), 'retired without a stamp')
  FROM unnest(ARRAY['owner', 'coach']) who;
SELECT t.legacy_locked(who, t.id('w-signed-unstamped'), 'signed without a stamp')
  FROM unnest(ARRAY['owner', 'coach']) who;

-- publish_team_waiver retires the unstamped row without stamping it; it stays locked.
SELECT t.as_user(t.id('owner'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (team_id, version, title, content, created_by)
    VALUES ('annex', 'v2', 'Annex waiver', 'Annex version two.', %L)$$, t.id('owner')),
  'L9: the owner drafts annex v2');
SELECT t.ok(public.publish_team_waiver((SELECT id FROM public.team_waivers WHERE team_id = 'annex' AND version = 'v2'))
  IS NOT NULL, 'L9: and publishes it');
SELECT t.reset();
SELECT t.eq((SELECT published::text || ':' || (published_at IS NULL)::text || ':' || (archived_at IS NOT NULL)::text
  FROM public.team_waivers WHERE id = t.id('w-unstamped')), 'false:true:true',
  'L9: the unstamped row is now retired, still without a published_at');
SELECT t.legacy_locked(who, t.id('w-unstamped'), 'retired by publishing v2, without a stamp')
  FROM unnest(ARRAY['owner', 'coach']) who;
SELECT t.eq((SELECT count(*)::int FROM annex_before b JOIN public.team_waivers w USING (id, version, title, content)), 3,
  'L9: all three keep their text');
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE team_id = 'annex'), 2,
  'L9: and both annex signatures survive');

-- ---- W15: a manager edits a draft's text, as the app does ----------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.eq(t.changed(format($$UPDATE public.team_waivers SET version = 'v3', title = 'Squad waiver 3',
    content = 'Version three, revised.' WHERE id = %L AND published_at IS NULL$$, t.waiver('v3'))), 1,
  'W15: a manager edits the draft''s version, title and text');
SELECT t.reset();
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.changed(format($$UPDATE public.team_waivers SET content = 'Version three, coach''s cut.'
    WHERE id = %L AND published_at IS NULL$$, t.waiver('v3'))), 1, 'W15: so does a coach');
SELECT t.reset();
SELECT t.eq((SELECT title || ':' || content || ':' || published::text FROM public.team_waivers WHERE id = t.waiver('v3')),
  'Squad waiver 3:Version three, coach''s cut.:false', 'W15: the draft holds the new text and is still a draft');

-- ---- W16: a manager deletes a draft, as the app does ---------------------------------------------------------
SELECT t.as_user(t.id('coach'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (team_id, version, title, content, created_by)
    VALUES ('squad', 'v4', 'Squad waiver', 'A draft to throw away.', %L)$$, t.id('coach')),
  'W16: a coach drafts v4');
SELECT t.reset();
SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.changed(format('DELETE FROM public.team_waivers WHERE id = %L AND published_at IS NULL', t.waiver('v4'))), 1,
  'W16: the owner deletes the draft');
SELECT t.reset();
SELECT t.ok(t.waiver('v4') IS NULL, 'W16: it is gone');

-- ---- W17: re-publishing a retired version through the function ----------------------------------------------
SELECT t.as_user(t.id('owner'));
SELECT t.eq(public.publish_team_waiver(t.waiver('v1')), t.waiver('v1'), 'W17: the owner re-publishes the retired v1');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(version || '=' || published::text || ':' || (archived_at IS NOT NULL)::text, ',' ORDER BY version)
  FROM public.team_waivers WHERE team_id = 'squad'), 'v1=true:false,v2=false:true,v3=false:false',
  'W17: v1 is the published one again, v2 is retired, v3 is still a draft');
SELECT t.eq((SELECT count(*)::int FROM public.team_waivers w JOIN squad_before b USING (id)
  WHERE w.published_at IS NOT DISTINCT FROM b.published_at AND b.version IN ('v1', 'v2')), 2,
  'W17: both keep the published_at of their first publication');
SELECT t.as_user(t.id('invitee'));
SELECT t.ok(public.sign_team_waiver('squad', t.waiver('v1')) IS NOT NULL, 'W17: the invitee signs the re-published v1');
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.waiver('v2')), 'WAIVER_NOT_PUBLISHED',
  'W17: the now retired v2 cannot be signed');
SELECT t.reset();
SELECT t.as_user(t.id('manager'));
SELECT t.refused(format($$UPDATE public.team_waivers SET content = 'Retired, so editable?' WHERE id = %L$$, t.waiver('v2')),
  'immutable', 'W17: the retired v2 stays immutable');
SELECT t.eq(t.would_change(format('DELETE FROM public.team_waivers WHERE id = %L', t.waiver('v2'))), 0,
  'W17: and cannot be deleted');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE team_id = 'squad'), 3,
  'W17: every signature is still there (the member''s and the invitee''s on v1, the invitee''s on v2)');

ROLLBACK;
