# Device pairing — verification

A guardian-issued, revocable way for a managed child to use their own device,
without ever giving them a password. See `supabase/migrations/20261001120000_managed_device_pairing.sql`,
`src/lib/device-pairing*.ts`, `src/routes/devices.pair.tsx`. Builds on
[`managed-children-verification.md`](./managed-children-verification.md): the
auth user a pairing grants access to is the same credential-less managed
child that document covers, so every control keyed on the child's auth id
(consent, controls, `isManagedUser()` gates) applies unchanged.

## How this was verified

**Behaviour was verified on a local replay; the live database has been
checked structurally (including a full function-body diff), not
behaviourally.** Same method as the managed-children document: the full
287-file migration chain plus this one (288 files) replayed on vanilla
Postgres 16 with the same Supabase stubs (`auth.users`, `auth.uid()` from
`request.jwt.claim.sub`, the API roles), then every function called **as the
role PostgREST would actually use** — `authenticated` with the caller's id in
the JWT claim for guardian/child actions, and `service_role` with no claim at
all for `lookup_device_pairing`, which is reachable with no caller identity by
design (see the migration's own comment on that function).

Cast: `parent` (the guardian, adult, confirmed email), `other` (an unrelated
adult), `kid` (a managed child already provisioned under `parent` by the
managed-children replay this one builds on).

One correction from the first pass of this replay, recorded rather than
hidden: the initial script called `lookup_device_pairing` as `anon` and the
partial-unique-index bypass test (D15) as `authenticated`, both of which
correctly got `permission denied` but proved nothing, since neither is the
role that actually reaches those code paths in production (the server
function uses the service-role client for the lookup; only `service_role` has
write access to the table at all). Re-run below uses `service_role` for both,
which is what exercises the intended logic.

### D1–D18

| # | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| D1 | Unrelated adult creates a pairing for the parent's kid | refused | `NOT_MANAGED` | PASS |
| D2 | The kid itself creates a pairing (not an adult) | refused | `ADULT_REQUIRED` | PASS |
| D3 | Guardian creates the first pairing | created; row `linked`, unconfirmed, unexpired, owned by guardian | created; `linked`, `paired_at` null, `expires_at` in the future, `child_user_id`/`created_by` correct | PASS |
| D4 | Lookup the right hash, via `service_role` | `linked` | `linked` | PASS |
| D5 | Lookup a wrong hash, via `service_role` | `invalid` | `invalid` | PASS |
| D6 | Confirm as a different (non-matching) session | no-op, `false`, no error | `false` | PASS |
| D7 | Confirm as the kid itself | `true`; row now shows `paired_at` set | `true`; confirmed | PASS |
| D8 | Confirm again | already confirmed, `false` | `false` | PASS |
| D9 | Lookup the same hash again, via `service_role` | `used` (precedence: used before expired) | `used` | PASS |
| D10 | Pair a second device | creates a new row; supersedes the first | created; exactly one `linked` row (the new one), the first flipped to `revoked` | PASS |
| D11 | Lookup the superseded (first) hash, via `service_role` | `revoked` (precedence: revoked before used/expired) | `revoked` | PASS |
| D12 | Unrelated adult revokes | refused | `NOT_MANAGED` | PASS |
| D13 | Guardian revokes the active pairing | `true`; row `revoked`, actor and timestamp recorded | `true`; `revoked`, `revoked_by` = guardian, `revoked_at` set | PASS |
| D14 | Revoke again | nothing linked left, refused | `PAIRING_NOT_FOUND` | PASS |
| D15 | Bypass `create_device_pairing` entirely: insert two `linked` rows for the same child directly, as `service_role` | first succeeds, second violates the partial unique index | first insert OK; second: `duplicate key … managed_device_pairings_one_active_idx` | PASS |
| D16 | Audit trail: every action logged, correct actor | `created`/`confirmed`/`superseded`/`created`/`revoked`, actor = guardian except `confirmed` (actor = kid) | exactly that sequence (×2, including the original validation run's rows — see below), actor correct on every row | PASS |
| D17 | RLS: guardian sees their pairing rows, a stranger sees none | own rows / 0 | 5 / 0 | PASS |
| D18 | `authenticated` (even the rightful guardian) writes the table directly | refused — all writes must go through the functions | `permission denied for table managed_device_pairings` | PASS |

D16 shows ten rows, not five: this replay database still held the five rows
from the run that originally validated this migration before it was applied
anywhere; this re-run reproduced the identical five-action sequence a second
time, independently, with the same actors on every row. The replay's test
rows for this child were deleted again afterwards (read/write only against
the disposable local replay, never against production).

## Applying the migration and publishing

Same two-step split as managed children: applying the migration and
publishing the app code are separate, and the new table/functions existing in
the database does not require the app to know about them yet. This migration
only adds a table and four `SECURITY DEFINER` functions — it changes no
existing table, column, policy, or function, so there is no equivalent of the
managed-children migration's "published before migrated" hazard (nothing
already-published references anything this migration adds). **Order used:
apply the migration, run the checks below, publish later** — the safer of the
two orderings for exactly that reason.

Applied to the live database through Lovable's project chat (never `supabase
db push`, per `docs/supabase-cli.md`): the exact SQL was pasted into the chat
with an instruction to run it unchanged. The branch carrying the app code
(`src/lib/device-pairing*.ts`, the new route, the Parent Center card) has not
merged, so Lovable's own migration tool — as it did for the managed-children
migration — saved its own copy on `main` directly: `drizzle/migrations/0002_managed_device_pairing.sql`
(278 lines; identical to `supabase/migrations/20261001120000_managed_device_pairing.sql`
except for the missing final newline, same as every prior migration applied
this way) and a regenerated `src/integrations/supabase/types.ts`. That
regenerated block is semantically identical to this branch's hand-written one
— same table shape, same four function signatures — differing only in
Prettier's semicolons-in-object-types versus the generator's commas, so
merging `main` into this branch is conflict-free.

**Unrelated, found and fixed by Lovable's agent while applying this
migration, not requested:** an earlier security fix had rewritten the grants
on `post_reactions` and left out the anon `SELECT` grant that the matching
`post_comments` table still had, so logged-out visitors got "permission
denied" loading reaction counts on the feed. Lovable restored
`GRANT SELECT ON public.post_reactions TO anon;` (`drizzle/migrations/0003_grant_post_reactions_anon_select.sql`,
also landed directly on `main`) and verified a logged-out read now returns
200. The RLS policy that scopes visibility was not touched. No app code was
changed. This is recorded here only because it happened in the same message
that applied this migration, the same way the managed-children document
records an unrelated `monetization_surfaces_ship_off` migration found while
checking that one.

Read-only structural checks against the live database (no user data read or
written):

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| L1 | `managed_device_pairings` columns | the 11 columns the migration defines, matching types and defaults | all 11 present: `id` (default `gen_random_uuid()`), `status` (default `'linked'`), `created_at` (default `now()`), the rest matching nullability | PASS |
| L2 | Indexes | `_pkey`, `code_hash` unique, `one_active_idx` (partial unique, `WHERE status='linked'`), `created_by_idx` | all four present, `one_active_idx`'s definition matches the migration verbatim including the partial `WHERE` clause | PASS |
| L3 | Row-level security | enabled | enabled | PASS |
| L4 | Policies | exactly one, SELECT, `authenticated`, `created_by = auth.uid() OR is_moderator(auth.uid())` | exactly that | PASS |
| L5 | Table grants | `authenticated`: SELECT only; `service_role`: full; no `anon`, no `PUBLIC` | exactly that | PASS |
| L6 | The four functions exist, `SECURITY DEFINER`, correct signatures | `create_device_pairing(uuid,text,text,int)`, `lookup_device_pairing(text)`, `confirm_device_pairing()`, `revoke_device_pairing(uuid)`, all `prosecdef = true` | all four, exact signatures, all `SECURITY DEFINER` | PASS |
| L7 | Function grants | `authenticated` + `service_role` EXECUTE on all four; no `anon`, no `PUBLIC` | exactly that | PASS |
| L8 | Live function bodies match the migration file | byte-identical logic (modulo Postgres's own canonical re-serialization: `int`→`integer`, `DEFAULT NULL`→`DEFAULT NULL::text`, `SET search_path = public`→`SET search_path TO 'public'`) | identical on all four, including every comment | PASS |

## Still to run on the live backend

None of this is possible until the branch carrying the app code is merged and
published — the database side is ready, but nothing live yet calls it:

1. `lookupDevicePairing`'s `admin.generateLink({ type: 'magiclink' })` call and
   the client's `verifyOtp({ type: 'email' })` redemption — the same primitive
   `startManagedSession` already proves out live (`managed-children-verification.md`,
   L12), but not yet exercised for a pairing code specifically.
2. The revoke mechanism actually ending a live session
   (`admin.updateUserById(childUserId, { ban_duration })`, and
   `startManagedSession`/`createDevicePairing` clearing a stale ban) — this is
   the one item the implementation plan named explicitly as spiked, not
   assumed, and it is still unverified against this project's actual
   Supabase auth settings.
3. `confirm_device_pairing()` called from a genuine child session (D6–D8 above
   only simulate the caller's id via `request.jwt.claim.sub`, not a real
   redeemed token).
4. The Parent Center card and `/devices/pair` end to end, including the
   guardian-copy-vs-child-device UI split (no "Back to guardian" on a paired
   device, since `readParkedGuardianSession()` is genuinely null there, unlike
   the act-as flow).
5. `e2e/device-pairing.spec.ts` (it skips itself until `HAS_BACKEND` and this
   migration are both present — the migration now is; a deployed environment
   with `VITE_SUPABASE_URL` set is still needed to run it at all).

## Known limitations

- Revoking ends **every** session the child has, not one device: Supabase's
  Admin API has no way to list or sign out a single session (no
  `listSessions`; `signOut(jwt, scope)` needs a JWT this server never holds).
  A device list implying per-row control would be misleading, so v1 supports
  exactly one active pairing at a time (D15 above).
- An access token already issued before a revoke keeps working until it
  expires on its own — Supabase has no way to kill a live access token early.
  Same accepted limitation as the act-as flow's "switching back is one tap,
  not a lock."
- No QR code: this sandbox's package manager is proxied to a restricted cache
  that couldn't fetch `qrcode.react`, with no way to confirm Lovable's own
  build would either. The code is short and typeable and the link is
  shareable without one.
- No rate limiting on `lookupDevicePairing` beyond code entropy (~50 bits) +
  10-minute TTL + single-use — consistent with `family-invites.functions.ts`,
  which relies on the same defense with no rate-limiting layer anywhere in
  this repo.

This records observed behaviour of specific controls. It is not a legal
compliance certification for COPPA, GDPR-K, or any other regime.
