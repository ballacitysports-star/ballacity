# SEC-2: helper functions are not oracles about other people (containment proposal)

Status: **implemented locally, open in a pull request based on `main`. Not merged, not applied to production, not verified in production.** It is independent of the open privacy stack and is the separately reviewable containment for a gap that exists in production today.

## The production gap (read-only check, 2026-11-05)

All 29 functions below exist in production as `SECURITY DEFINER` and are executable by every signed-in account; none is executable anonymously. Each accepts an arbitrary user id, so a signed-in stranger can call them through the API (`/rpc/<name>`) and learn, for any account id: team membership and role, game participation, the guardian relationship, shared teams, conversation participation, blocks, whether the person is a minor, age verification, platform status, roles, entitlements, AI and payment permissions, and the minor-messaging rule outcome for any pair.

`age_verified`, `ai_analysis_allowed`, `blocks_exist_between`, `can_notify`, `child_game_participation_allowed`, `default_profile_visibility_for`, `game_payments_allowed`, `has_entitlement`, `has_role`, `is_conversation_participant`, `is_game_participant`, `is_guardian_of`, `is_gym_admin_text`, `is_managed_account`, `is_minor`, `is_moderator`, `is_org_member`, `is_superadmin`, `is_team_manager`, `is_team_member`, `is_trainer_org_admin`, `is_trainer_org_member`, `minor_messaging_allowed`, `minor_messaging_block`, `minor_messaging_block_reason`, `platform_status`, `shares_team`, `team_role_of`, `trainer_profile_owned_by`.

## The fix, and why it does not break anything

- No function body and no row-security decision changes. Each function is **moved** to `private_sec` (`ALTER FUNCTION ... SET SCHEMA`). Policies reference functions by OID, so every existing policy keeps calling the original logic; `private_sec` is not exposed by the API.
- A same-named **public wrapper** answers for everything that calls by name (other functions, server code, the app). It returns the real answer, except for a **direct API call of that function** (request path `/rpc/<name>`, or the statement text calls it) by a signed-in caller who is **not one of the people asked about and not staff**. That call gets a fixed answer that reveals nothing (`false`, `NULL`, `'private'`, `'not_permitted'`).
- The service role (no `auth.uid()`), internal triggers and policies, staff, and a person asking about themselves are unaffected. Every app call site was checked: all ask about the signed-in user or run with the service role.
- `private_sec.wrap_oracle_helpers()` is idempotent; the privacy stack re-runs it after R7 redefines `minor_messaging_block` and `can_notify` (SEC-1).

## Tests

`supabase/tests/480_helper_oracle_containment.test.sql` (22 assertions): every helper wrapped, originals moved and still used by policies; a stranger's direct probes of team membership, games, guardian, shared team, role, age, messaging and notification relations return the safe answer (with and without `request.path`); self, staff and service role get the truth; a manager still reads the roster through row security; a function that calls the helpers by name still works; anonymous still cannot call them; re-running is a no-op. Against `main` without the migration 13 assertions fail. Full SQL suite on this branch: 918 passed, 0 failed.

## Before production (needs separate approval)

1. In the verified sandbox, confirm the API sets `request.path` and that `private_sec` is not in the exposed schemas (Supabase dashboard, API settings). If `private_sec` were exposed, the moved originals would be callable there and the containment would not hold.
2. Apply with `SET lock_timeout = '5s'`. The moves take a brief lock on each function only.
3. Verify (read-only): 29 functions in `public` carry the comment `oracle-wrapper`; `select public.is_team_member('<team>', '<someone else>')` through the API as an unrelated test account returns false.

Rollback: forward-fix only (re-creating the public functions with their original bodies would reopen the oracle). Owner decision recorded in the PR.
