-- A 13-15 player's reel can reach their team only when their guardian approves
-- it, and only while every condition behind that approval still holds.
-- teen_reel_viewer_access() answers "what may this viewer see" ('owner',
-- 'guardian', 'team' or 'none'); guard_teen_reel_team() controls who may set
-- the approval. Both are server-side only: the app calls them with the service
-- role after its own checks, so the database must refuse everything else.
BEGIN;

SELECT t.person('coachone', 35), t.person('guardian', 41), t.person('stranger', 29),
       t.person('teenmid', 14), t.person('teenold', 17), t.person('mate', 15),
       t.person('youngmate', 11), t.person('suspendedmate', 15), t.person('outsider', 15);
SELECT t.guardian('guardian', 'teenmid');
SELECT t.guardian('guardian', 'mate');
SELECT t.guardian('guardian', 'youngmate');
SELECT t.guardian('guardian', 'suspendedmate');

SELECT t.team('squad', 'coachone');
SELECT t.team('othersquad', 'coachone');
SELECT t.member('squad', 'teenmid'), t.member('squad', 'teenold'), t.member('squad', 'mate'),
       t.member('squad', 'youngmate'), t.member('squad', 'suspendedmate');
UPDATE public.profiles SET suspended_at = now(), moderation_state = 'suspended' WHERE id = t.id('suspendedmate');

SELECT t.reel('teenmid', 'teen');
SELECT t.reel('teenold', 'teenold');

-- Before any approval the reel stays with the family.
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('teenmid')), 'owner', 'the player is the owner');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('guardian')), 'guardian', 'the guardian sees it');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'none', 'a teammate sees nothing before approval');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('stranger')), 'none', 'a stranger sees nothing');

-- A player cannot approve their own reel for the team, even naming their guardian.
SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(
  format('UPDATE public.highlight_reels SET team_share_team_id = ''squad'', guardian_team_approved_by = %L WHERE id = %L',
         t.id('guardian'), t.id('reel-teen')),
  'TEEN_TEAM_GUARDIAN_ONLY', 'a player cannot approve their own reel for the team');
SELECT t.reset();

-- The server records the approval for a verified guardian only.
SELECT t.throws(
  format('UPDATE public.highlight_reels SET team_share_team_id = ''squad'', guardian_team_approved_by = %L WHERE id = %L',
         t.id('stranger'), t.id('reel-teen')),
  'TEEN_TEAM_GUARDIAN_ONLY', 'approval from someone who is not their guardian is refused');
SELECT t.throws(
  format('UPDATE public.highlight_reels SET team_share_team_id = ''othersquad'', guardian_team_approved_by = %L WHERE id = %L',
         t.id('guardian'), t.id('reel-teen')),
  'TEEN_TEAM_NOT_ON_TEAM', 'approval for a team the player is not on is refused');
SELECT t.throws(
  format('UPDATE public.highlight_reels SET team_share_team_id = ''squad'', guardian_team_approved_by = %L WHERE id = %L',
         t.id('guardian'), t.id('reel-teenold')),
  'TEAM_NOT_', 'a 16-17 reel cannot use the guardian team path');

UPDATE public.highlight_reels SET team_share_team_id = 'squad', guardian_team_approved_by = t.id('guardian')
 WHERE id = t.id('reel-teen');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'team', 'an adult-approved teammate can see it');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('coachone')), 'team', 'the team owner can see it');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('teenold')), 'team', 'a 16-17 teammate can see it');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('outsider')), 'none', 'someone not on the team cannot');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('stranger')), 'none', 'a stranger still cannot');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('youngmate')), 'none', 'an under-13 teammate cannot');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('suspendedmate')), 'none', 'a suspended teammate cannot');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), NULL), 'none', 'an anonymous visitor cannot');
SELECT t.eq(public.reel_audience(t.id('reel-teen')), 'none', 'the team path never makes the reel public');

-- Each condition is re-checked on every view, so access ends the moment one stops holding.
UPDATE public.highlight_reels SET hidden_at = now() WHERE id = t.id('reel-teen');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'none', 'a hidden reel is closed to the team');
UPDATE public.highlight_reels SET hidden_at = NULL, is_draft = true WHERE id = t.id('reel-teen');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'none', 'a draft is closed to the team');
UPDATE public.highlight_reels SET is_draft = false WHERE id = t.id('reel-teen');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'team', 'restoring the reel reopens it');

DELETE FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('mate');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'none', 'a teammate who leaves loses access');
SELECT t.member('squad', 'mate');

UPDATE public.guardian_links SET status = 'revoked' WHERE parent_user_id = t.id('guardian') AND child_user_id = t.id('teenmid');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'none', 'ending the guardian link ends the approval');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('guardian')), 'none', 'and the former guardian loses access too');
UPDATE public.guardian_links SET status = 'active' WHERE parent_user_id = t.id('guardian') AND child_user_id = t.id('teenmid');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'team', 'reinstating the link restores it');

-- Anyone may narrow the reel back to the family.
SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(
  format('UPDATE public.highlight_reels SET team_share_team_id = NULL, guardian_team_approved_by = NULL, guardian_team_approved_at = NULL WHERE id = %L', t.id('reel-teen')),
  'the player can withdraw the team approval');
SELECT t.reset();
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-teen'), t.id('mate')), 'none', 'withdrawing closes it to the team');

-- Only the server (service role) may ask these questions.
SELECT t.eq(has_function_privilege('anon', 'public.teen_reel_viewer_access(uuid,uuid)', 'EXECUTE'), false, 'anon cannot call teen_reel_viewer_access');
SELECT t.eq(has_function_privilege('authenticated', 'public.teen_reel_viewer_access(uuid,uuid)', 'EXECUTE'), false, 'signed-in users cannot call teen_reel_viewer_access');
SELECT t.eq(has_function_privilege('service_role', 'public.teen_reel_viewer_access(uuid,uuid)', 'EXECUTE'), true, 'the service role can call teen_reel_viewer_access');

ROLLBACK;
