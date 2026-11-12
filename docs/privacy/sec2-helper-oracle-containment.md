# SEC-2: helper functions are not oracles about other people (containment)

Status: **implemented locally on a branch from `main` (`claude/sec2-helper-oracles-main`), rebuilt from PR #273. Not merged, not applied to the sandbox or to production.** Migration `supabase/migrations/20261112150000_helper_oracle_containment.sql`, test `supabase/tests/820_helper_oracle_containment.test.sql`, guarded rollback `docs/rollbacks/20261112150000_helper_oracle_containment.down.sql`.

## The gap (replay of `main` 73defe41, 2026-11-12)

The 26 functions below are `SECURITY DEFINER`, executable by every signed-in account (none anonymously), and accept an arbitrary user id. A signed-in stranger can call them through the API (`/rpc/<name>`) and learn, for any account id: team membership and role, game participation, the guardian relationship, shared teams, conversation participation, blocks, whether the person is a minor, age verification, platform status, roles, entitlements, AI and payment permissions, and whether two people may notify each other. On the replay, a stranger asking about a 15 year old got `is_minor = true`, `is_guardian_of(parent, teen) = true`, `is_team_member = true`, `team_role_of = player`, `shares_team(coach, teen) = true`, `age_verified = true`, `platform_status = active`, `default_profile_visibility_for = members`.

`age_verified`, `ai_analysis_allowed`, `blocks_exist_between`, `can_notify`, `child_game_participation_allowed`, `default_profile_visibility_for`, `game_payments_allowed`, `has_entitlement`, `has_role`, `is_conversation_participant`, `is_game_participant`, `is_guardian_of`, `is_gym_admin_text`, `is_managed_account`, `is_minor`, `is_moderator`, `is_org_member`, `is_superadmin`, `is_team_manager`, `is_team_member`, `is_trainer_org_admin`, `is_trainer_org_member`, `platform_status`, `shares_team`, `team_role_of`, `trainer_profile_owned_by`.

PR #273 also listed `minor_messaging_block`, `minor_messaging_block_reason` and `minor_messaging_allowed`. `20261106150000_close_authenticated_oracles` (P0-2) has since made them service-role only, so this migration leaves them as they are (820 checks they stay closed).

## The fix, and why it does not break anything

- No helper body and no row-security decision changes. Each function is **moved** to `private_sec` (`ALTER FUNCTION ... SET SCHEMA`). Policies reference functions by OID, so every existing policy (about 110 of them) keeps calling the original logic; `private_sec` is not exposed by the API.
- A same-named **public SECURITY INVOKER wrapper** answers for everything that calls by name (other functions, server code, the app). It passes its own `current_user` to `private_sec.rpc_probe_denied`. The check is **structural**: when the wrapper runs as the API role itself (`authenticated` or `anon`), the call came straight from a client (PostgREST `/rpc/<name>`, a GraphQL field, or invoker code running for the client). Inside a `SECURITY DEFINER` function `current_user` is that function's owner, so every internal use is unaffected. A direct client call by someone who is **not staff** gets a fixed answer that reveals nothing (`false`, `NULL`, `'private'`), unless the helper only answers about the caller and the caller is that person.
- **Two-party helpers that reveal the other person's state have no party exemption:** `blocks_exist_between`, `shares_team`, `can_notify`. Every direct client call by a non-staff account gets the fixed answer, even when the caller names themselves as one party.
- The service role (no `auth.uid()`), every `SECURITY DEFINER` caller, staff, and a person asking a one-party helper about themselves are unaffected.
- The three `SECURITY INVOKER` functions that name a helper call `private_sec` directly: the `guard_team_member_role_change()` trigger (`team_role_of`), and `following_feed` / `following_team_news` (`is_team_member(p.team_id, auth.uid())`). No view and no other invoker function calls a helper by name (820 checks this).

## App call sites, and the order of release

Every `supabase.rpc(...)` call of these helpers in `src/` was checked. All but three ask about the session user with the signed-in client, or already use the service role, and are unaffected:

- signed-in client, about the caller: `has_role` (admin, audit-log, compliance, legal-documents, seed-test-accounts, staff), `is_superadmin` (superadmin, monetization analytics, compliance, staff, content-studio), `is_moderator` (moderation, audit-log, child-safety, listings, staff, content-studio), `is_team_manager` (team-roster, tryouts x10, `routes/tryouts.$postId.tsx`), `is_trainer_org_admin` (trainer-orgs x4, court-inquiries, `routes/orgs.$orgId.members.tsx`), `is_guardian_of(caller, child)` (child-safety x2), `ai_analysis_allowed` (reels), `game_payments_allowed` and `age_verified` (`payments.ts`, the player's own proof).
- service role already: `is_guardian_of` (family-clips x3, coach-analytics, public-xp, teen-reels), `is_team_manager` (coach-analytics), `ai_analysis_allowed` (ai gate, skill-rating, reels worker), `is_superadmin` (content-studio server), `blocks_exist_between` (player-passport).

The three that change (this branch):

1. `createNotificationForUser` (`src/lib/notifications.functions.ts`) asked `can_notify(caller, target)` with the signed-in client.
2. `sendPushToUser` (`src/lib/push.functions.ts`), likewise.
3. `reviewPaymentAction` (`src/lib/payments.functions.ts`) asked `game_payments_allowed` about the **player** with the host's signed-in client.

After the SQL, each of these would get the fixed `false`: every cross-user notification and push would be refused, and a host could not confirm a payment. They now ask with the service role, `_caller` being the verified session user. `reviewPaymentAction` first establishes, with the service role, that the caller hosts the game and that the player is already linked to it (participant, pending or approved request, or a submission); only then does it ask the player's gate. The host's own gate still uses the caller's client. So the function cannot be used to probe an arbitrary account's cohort, and `enforce_game_payment_cohort` remains the database backstop.

**Order: publish the app first, then apply the SQL.** The new app code gives the same answers before and after the migration. The old app code breaks the three flows above as soon as the migration is applied.

## Later migrations that redefine a helper

- **Prefer `CREATE OR REPLACE FUNCTION private_sec.<helper>(...)`** for a new body. It keeps the OID every policy points at, and the public wrapper needs nothing.
- If a migration redefines `public.<helper>` instead (with `CREATE OR REPLACE`, or `DROP` and `CREATE`), it must re-run `SELECT private_sec.wrap_oracle_helpers();`. That copies the new body into the **existing** `private_sec.<helper>` with `CREATE OR REPLACE`, together with the new definition's owner and grants. It never drops the private copy, because the policies depend on these OIDs. It then rebuilds the public wrapper in place and repoints at `private_sec` any policy that was created against the public name.
- A helper counts as wrapped only when `public.<helper>` is `SECURITY INVOKER` and calls `private_sec.rpc_probe_denied`. The `oracle-wrapper` comment survives `CREATE OR REPLACE`, so it is a label, not evidence.
- A redefinition that renames a parameter or changes the return type cannot replace the private copy in place. `wrap_oracle_helpers()` then stops with an error rather than drop the copy the policies use.
- New `SECURITY INVOKER` functions, views and triggers must call `private_sec.<helper>`, not the public wrapper.

## Tests

`supabase/tests/820_helper_oracle_containment.test.sql` (90 assertions). It checks that all 26 helpers are wrapped, that the originals moved and are still used by policies, and that no policy, view or invoker function calls a public wrapper. A stranger's direct probes get the safe answer, with and without `request.path`; a GraphQL-style dynamic call of each of the 26 gets its fixed answer. The three two-party helpers give the fixed answer when the caller is a party. Self, staff and the service role get the truth. A manager still reads the roster through row security; a definer function that calls the helpers by name still works; the role-change trigger behaves as before; a team member still gets their team's members-only post and news in the Following feed, a stranger does not. Anonymous still cannot call the helpers, and `minor_messaging_*` stay closed. Re-running is a no-op. A `CREATE OR REPLACE` of `public.can_notify` and `public.is_minor` with definer bodies, then a re-wrap, is contained again (private OIDs kept, definer callers and policies see the new logic). A drop and recreate of `is_team_member`, then a re-wrap, succeeds. A later policy naming a public helper is repointed.

Negative control: run against `main` without the migration, 34 assertions fail before the file stops at the missing `wrap_oracle_helpers()`. `src/lib/sec2-helper-callers.test.ts` covers the three app call sites; against `main`'s versions of those files 5 of its 7 tests fail.

Rollback check: on a replay of `main`, migration then rollback gives a catalog identical to `main` (every function in `public` and `private_sec`: OID, schema, definition, grants, owner, comment; every policy: expressions, roles, command). The rollback refuses to run without `app.confirm_helper_oracle_containment_rollback = 'yes'`.

## Before production (needs separate approval)

1. Publish the app (with this branch's three server changes) and verify it is live.
2. In the verified sandbox, confirm that `private_sec` is **not** in the API's exposed schemas (Supabase dashboard, API settings). If it were, the moved originals would be callable there and the containment would not hold.
3. Confirm that pg_graphql is disabled (`select * from pg_extension where extname = 'pg_graphql'` is empty), or that it does not expose the public wrappers. The wrappers deny a stranger's GraphQL call too, but GraphQL must not become a second API to reason about.
4. Apply (the file sets `lock_timeout = '5s'`; the moves take a brief lock on each function only).
5. Verify (read-only): 26 functions in `public` are `SECURITY INVOKER` and call `private_sec.rpc_probe_denied`; `select public.is_team_member('<team>', '<someone else>')` through the API as an unrelated test account returns false; a cross-user notification and a host's payment review still work.

If the sandbox ever had PR #273's `20261103150000` applied, its wrappers (29, including `minor_messaging_*`) are already in place and this file only re-runs the wrapping; check that before applying.
