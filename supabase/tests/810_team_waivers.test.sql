-- Team waivers (drizzle/migrations/0008_team_waivers.sql): the W1-W14 checks from the stale PR #27's
-- verification doc (docs/guardian-team-approvals-verification.md on claude/guardian-team-approvals), run
-- against main. Managers (owner, manager, coach) write drafts that only they see, publish them through
-- publish_team_waiver, and a published version cannot be edited in place, moved or deleted (but see the known
-- gap below); one published version per team. Members and pending invitees of that team sign through
-- sign_team_waiver only, once each, and only its published waiver.
--
-- Not here, on purpose:
--   * W10 (a guardian signs for their child with the attestation, signed_by = the guardian). Who may sign a
--     team waiver for a minor (the guardian, the minor themself, nobody through this function) is an owner
--     question, so this file asserts no success case of signing for or as a minor. W9 stays because it is a
--     refusal whoever turns out to be allowed: nothing is signed on a child's behalf without the attestation.
--     For the record, sign_team_waiver has no age check, so today a minor member signs for themself (not asserted).
--   * Joining past an unsigned waiver (WAIVER_REQUIRED on team_respond_invite and guardian_approve_team_invite):
--     30_guardian_gates.test.sql. Event sign-ups that sign the waiver: 630_events_stage1 and 710.
--
-- Known gap on main, not asserted here: team_waivers_guard keys on OLD.published_at, and the manager UPDATE
-- policy allows every column, so a manager can clear published_at (or set published = true directly, leaving
-- published_at NULL) and then edit the waiver, or delete it with its signatures. Reported, not fixed here.
BEGIN;

SELECT t.person('owner', 40), t.person('manager', 38), t.person('member', 30), t.person('invitee', 26),
       t.person('declined', 27), t.person('stranger', 29), t.person('guardian', 44), t.person('teen', 14),
       t.person('elsewhere', 31);
SELECT t.guardian('guardian', 'teen');
SELECT t.team('squad', 'owner');
SELECT t.team('other', 'stranger');
SELECT t.team('annex', 'owner'); -- a second team the owner manages, so a move between them passes row level security
SELECT t.member('squad', 'manager', 'manager');
SELECT t.member('squad', 'member', 'player');
SELECT t.member('squad', 'teen', 'player');
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by) VALUES
  (t.id('invite-pending'), 'squad', t.id('invitee'), t.id('owner')),
  (t.id('invite-declined'), 'squad', t.id('declined'), t.id('owner'));
UPDATE public.team_invites SET status = 'declined', responded_at = now() WHERE id = t.id('invite-declined');
-- A pending invite, but to another team: it does not make them an invitee of squad.
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by) VALUES
  (t.id('invite-elsewhere'), 'other', t.id('elsewhere'), t.id('stranger'));

-- ---- W1: a manager creates a draft ---------------------------------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (id, team_id, version, title, content, created_by)
    VALUES (%L, 'squad', 'v1', 'Squad waiver', 'Version one terms.', %L)$$, t.id('w-v1'), t.id('manager')),
  'W1: a manager creates a draft');
SELECT t.throws(format($$INSERT INTO public.team_waivers (team_id, version, content, published, published_at, created_by)
    VALUES ('squad', 'v0', 'Straight to published.', true, now(), %L)$$, t.id('manager')),
  'row-level security', 'W1: a draft cannot be inserted already published');
SELECT t.reset();
SELECT t.as_user(t.id('member'));
SELECT t.throws(format($$INSERT INTO public.team_waivers (team_id, version, content, created_by)
    VALUES ('squad', 'vx', 'A player''s waiver.', %L)$$, t.id('member')),
  'row-level security', 'W1: a player cannot create a waiver');
SELECT t.reset();
SELECT t.eq((SELECT published::text || ':' || (published_at IS NULL)::text FROM public.team_waivers WHERE id = t.id('w-v1')),
  'false:true', 'W1: the draft is stored unpublished');

-- ---- W2: a draft is the managers' alone ----------------------------------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.id('w-v1'))), 0,
  'W2: a member does not see the draft');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.id('w-v1'))), 0,
  'W2: nor does a stranger');
SELECT t.reset();
SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.id('w-v1'))), 1,
  'W2: the team owner (a manager) does');
SELECT t.reset();

-- ---- W3: a manager publishes it ------------------------------------------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.throws(format('SELECT public.publish_team_waiver(%L)', t.id('w-v1')), 'NOT_TEAM_MANAGER',
  'W3: a member cannot publish');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.publish_team_waiver(%L)', t.id('w-v1')), 'NOT_TEAM_MANAGER',
  'W3: nor a stranger');
SELECT t.reset();
SELECT t.as_user(t.id('manager'));
SELECT t.eq(public.publish_team_waiver(t.id('w-v1')), t.id('w-v1'), 'W3: a manager publishes the draft');
SELECT t.reset();
SELECT t.eq((SELECT published::text || ':' || (published_at IS NOT NULL)::text FROM public.team_waivers WHERE id = t.id('w-v1')),
  'true:true', 'W3: it is published, with a published_at');
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_waivers WHERE id = %L', t.id('w-v1'))), 1,
  'W3: members now see it');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.team_waivers'), 0, 'signed-out visitors see no waiver');
SELECT t.reset();

-- ---- W4: a published version cannot be edited ----------------------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format($$UPDATE public.team_waivers SET content = 'Quietly changed.' WHERE id = %L$$, t.id('w-v1')),
  'immutable', 'W4: a published waiver''s content cannot be edited');
SELECT t.throws(format($$UPDATE public.team_waivers SET title = 'Renamed' WHERE id = %L$$, t.id('w-v1')),
  'immutable', 'W4: nor its title');
SELECT t.throws(format($$UPDATE public.team_waivers SET version = 'v1b' WHERE id = %L$$, t.id('w-v1')),
  'immutable', 'W4: nor its version');
SELECT t.reset();
-- The RETURNING clause runs only on a row the guard let through (it reads the row, so it is not folded away at
-- plan time): it then raises "division by zero", which fails the check and rolls the move back, so the checks
-- below still run against squad.
SELECT t.as_user(t.id('owner'));
SELECT t.throws(format($$UPDATE public.team_waivers SET team_id = 'annex' WHERE id = %L RETURNING length(team_id) / 0$$,
    t.id('w-v1')),
  'immutable', 'W4: nor moved to another team the same person manages');
SELECT t.reset();
SELECT t.eq((SELECT team_id || ':' || content FROM public.team_waivers WHERE id = t.id('w-v1')), 'squad:Version one terms.',
  'W4: the published text is unchanged, on the same team');

-- ---- W7, W8: an adult member signs for themself, once --------------------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.ok(public.sign_team_waiver('squad', t.id('w-v1')) IS NOT NULL, 'W7: an adult member signs for themself');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id = t.id('w-v1') AND signer_user_id = t.id('member')),
  1, 'W7: one signature');
SELECT t.ok((SELECT signed_by IS NULL FROM public.team_waiver_signatures WHERE waiver_id = t.id('w-v1') AND signer_user_id = t.id('member')),
  'W7: signed for themself (signed_by empty)');
SELECT t.as_user(t.id('member'));
SELECT t.lives(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-v1')), 'W8: signing again is not an error');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id = t.id('w-v1') AND signer_user_id = t.id('member')),
  1, 'W8: still one signature');

-- ---- W5: publishing v2 retires v1 ----------------------------------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (id, team_id, version, title, content, created_by)
    VALUES (%L, 'squad', 'v2', 'Squad waiver', 'Version two terms.', %L)$$, t.id('w-v2'), t.id('manager')),
  'W5: a manager drafts v2');
SELECT t.eq(public.publish_team_waiver(t.id('w-v2')), t.id('w-v2'), 'W5: and publishes it');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(version || '=' || published::text || ':' || (archived_at IS NOT NULL)::text, ',' ORDER BY version)
  FROM public.team_waivers WHERE team_id = 'squad'), 'v1=false:true,v2=true:false',
  'W5: v1 is unpublished and archived, v2 is the published one');
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format($$UPDATE public.team_waivers SET content = 'Rewrite history.' WHERE id = %L$$, t.id('w-v1')),
  'immutable', 'W5: a retired version stays immutable');
SELECT t.reset();

-- ---- W6: one published version per team, even writing the rows directly -------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format('UPDATE public.team_waivers SET published = true WHERE id = %L', t.id('w-v1')),
  'team_waivers_one_published_per_team', 'W6: a second published version is refused by the unique index');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waivers WHERE team_id = 'squad' AND published), 1,
  'W6: the team still has exactly one published waiver');

-- ---- W9: nothing is signed on a child's behalf without the attestation ---------------------------------------
-- A refusal only. Whether anyone may sign for a minor (W10's success case) is the owner's question; see the top.
SELECT t.as_user(t.id('guardian'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L, %L, false)$$, t.id('w-v2'), t.id('teen')),
  'ATTESTATION_REQUIRED', 'W9: signing for a child without the attestation is refused');
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L, %L)$$, t.id('w-v2'), t.id('teen')),
  'ATTESTATION_REQUIRED', 'W9: and the attestation is not assumed when left out');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L, %L, true)$$, t.id('w-v2'), t.id('teen')),
  'NOT_YOUR_GUARDIAN_LINK', 'W9: someone with no guardian link cannot sign for the child, attestation or not');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE signer_user_id = t.id('teen')), 0,
  'W9: no signature exists for the child');

-- ---- W11, W12: who can sign for themself ---------------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-v2')), 'NOT_TEAM_MEMBER_OR_INVITEE',
  'W11: a stranger (not a member, not invited) cannot sign');
SELECT t.reset();
SELECT t.as_user(t.id('declined'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-v2')), 'NOT_TEAM_MEMBER_OR_INVITEE',
  'W11: nor someone whose invite was declined');
SELECT t.reset();
SELECT t.as_user(t.id('elsewhere'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-v2')), 'NOT_TEAM_MEMBER_OR_INVITEE',
  'W11: nor someone whose pending invite is to another team');
SELECT t.reset();
SELECT t.as_user(t.id('invitee'));
SELECT t.ok(public.sign_team_waiver('squad', t.id('w-v2')) IS NOT NULL, 'W12: an adult with a pending invite signs');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id = t.id('w-v2') AND signer_user_id = t.id('invitee')),
  1, 'W12: one signature for the invitee');
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures
  WHERE signer_user_id IN (t.id('stranger'), t.id('declined'), t.id('elsewhere'))), 0,
  'W11: none for the stranger, the declined invitee or the one invited elsewhere');

-- ---- W13: signatures are written through sign_team_waiver only -----------------------------------------------
SELECT t.as_user(t.id('member'));
SELECT t.throws(format($$INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id)
    VALUES (%L, 'squad', %L)$$, t.id('w-v2'), t.id('member')),
  'row-level security', 'W13: a member cannot insert their own signature row');
SELECT t.eq(t.changed(format('UPDATE public.team_waiver_signatures SET signed_by = %L WHERE signer_user_id = %L',
    t.id('guardian'), t.id('member'))), 0, 'W13: nor rewrite their signature');
SELECT t.eq(t.changed(format('DELETE FROM public.team_waiver_signatures WHERE signer_user_id = %L', t.id('member'))), 0,
  'W13: nor delete it');
SELECT t.reset();
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format($$INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by)
    VALUES (%L, 'squad', %L, %L)$$, t.id('w-v2'), t.id('teen'), t.id('guardian')),
  'row-level security', 'W13: a manager cannot write a signature for someone');
SELECT t.eq(t.changed(format('DELETE FROM public.team_waiver_signatures WHERE team_id = %L', 'squad')), 0,
  'W13: nor delete the team''s signatures');
SELECT t.eq(t.changed(format('DELETE FROM public.team_waivers WHERE id = %L', t.id('w-v2'))), 0,
  'W13: nor delete the current published version (which would take its signatures with it)');
SELECT t.eq(t.changed(format('DELETE FROM public.team_waivers WHERE id = %L', t.id('w-v1'))), 0,
  'W13: nor delete a retired version');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE team_id = 'squad'), 2,
  'W13: both signatures are still there');

-- ---- W14: only the team's published waiver can be signed ----------------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($$INSERT INTO public.team_waivers (id, team_id, version, title, content, created_by)
    VALUES (%L, 'squad', 'v3', 'Squad waiver', 'Version three draft.', %L)$$, t.id('w-v3'), t.id('manager')),
  'W14: a manager drafts v3');
SELECT t.reset();
INSERT INTO public.team_waivers (id, team_id, version, title, content, published, published_at, created_by)
VALUES (t.id('w-other'), 'other', 'v1', 'Other waiver', 'Another team''s terms.', true, now(), t.id('stranger'));
SELECT t.as_user(t.id('member'));
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-v3')), 'WAIVER_NOT_PUBLISHED',
  'W14: a draft cannot be signed');
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-v1')), 'WAIVER_NOT_PUBLISHED',
  'W14: nor a retired version');
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-other')), 'WAIVER_NOT_PUBLISHED',
  'W14: nor another team''s waiver named against this team');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws(format($$SELECT public.sign_team_waiver('squad', %L)$$, t.id('w-v2')), 'permission denied',
  'signed-out visitors cannot call sign_team_waiver');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_waiver_signatures WHERE waiver_id IN (t.id('w-v3'), t.id('w-other'))), 0,
  'W14: nothing was signed');

ROLLBACK;
