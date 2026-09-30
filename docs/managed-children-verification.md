# Managed children — verification

Managed children are minors a guardian adds without giving them an email or
password. Each one is a real auth user with no usable credentials (placeholder
address on the reserved `managed.invalid` domain, no password), created by the
app's server function with the service role and provisioned by
`provision_managed_child()` running **as the guardian**. Because the child is a
real auth user, every control verified in
[`family-architecture-final-verification.md`](./family-architecture-final-verification.md)
and [part 2](./family-architecture-verification-part2.md) keys on the child's
auth id and applies unchanged. This supersedes the stage-3 plan for
`player_profiles` (see the note at the end of the final-verification doc).

Code: `supabase/migrations/20260930120000_managed_children.sql`,
`supabase/migrations/20260930121000_freeze_player_profiles.sql`,
`src/lib/managed-children*.ts`, `src/lib/managed-session.ts`.

## How this was verified

**Not yet against the live backend.** The migrations are applied through Lovable
(`docs/supabase-cli.md`: never by hand on the production project), so this run
replayed the **entire migration chain (287 files) on vanilla Postgres 16** with
minimal Supabase stubs (`auth.users`, `auth.uid()` from the
`request.jwt.claim.sub` setting, `storage`/`realtime` tables, the API roles),
then called every function **as the `authenticated` role with the caller's id in
the JWT claim** — the same way PostgREST evaluates a real user's request. Two
adjustments were needed for vanilla Postgres and are recorded, not hidden:

- `MAINTAIN` (a Postgres 17 privilege, used by `20260731205616`) was stripped —
  production runs Postgres 17.
- `public.guard_profile_moderation_fields()` exists in production but no
  migration creates it (schema drift); a no-op stub was created so
  `20260915225632` could revoke it.

Cast: `parent` (adult, confirmed email), `other` (unrelated adult), `teenacct`
(a 13–15 with their own login), `stranger` (adult), and managed children created
the way the server function does — `raw_app_meta_data = {managed: true,
managed_by: parent}`, placeholder email, no password.

## Provisioning

| # | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M1a | Parent provisions a 10-year-old | created, consent recorded | `child_under_13`, `consent=true` | PASS |
| M1b | Parent provisions a 16-year-old | created, no consent row (not required for 16–17) | `teen_16_17`, `consent=false` | PASS |
| M1c | Parent provisions a 14-year-old | created, consent recorded; account active | `teen_13_15`, `consent=true`; `platform_status` `active`, not locked | PASS |
| M2 | A 13–15 login provisions a child | refused | `ADULT_REQUIRED` | PASS |
| M2b | A managed child's own session provisions a child | refused | `ADULT_REQUIRED` | PASS |
| M3 | Another adult provisions the parent's child | refused | `NOT_YOUR_MANAGED_CHILD` | PASS |
| M3b | Child user created more than 15 minutes ago | refused | `NOT_YOUR_MANAGED_CHILD` | PASS |
| M3c | `app_metadata.managed = false` | refused | `NOT_YOUR_MANAGED_CHILD` | PASS |
| M3d | Anonymous caller | refused | `AUTH_REQUIRED` | PASS |
| M4 | Provisioning the same child again | refused | `ALREADY_PROVISIONED` | PASS |
| M4b | No guardian attestation | refused | `ATTESTATION_REQUIRED` | PASS |
| M4c | Adult birthday | refused | `CHILD_IS_ADULT` | PASS |
| M4d | Name containing digits | refused | `NAME_INVALID` | PASS |
| M4e | Terms version older than the published one | refused | `LEGAL_VERSION_STALE` | PASS |
| M4f | Sixth child in 24 hours | refused | `MANAGED_LIMIT` on the 6th | PASS |

## Resulting state

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M5 | Profile | name/initials/sport set, `account_type = player`, cohort derived | `Jake S.`, `JS`, `Basketball`, `player`, `child_under_13` | PASS |
| M6 | Guardian link | active and verified | `active`, `verified_at` set, relationship kept | PASS |
| M7 | Consent (under 13) | approved, method, versions, scope | `approved`, `email_confirmation`, `2026-09-01`/`2026-09-01`, `{source: managed_child, guardian_attested: true}` | PASS |
| M8 | Child controls (both cohorts) | safe defaults | `guardian_only` messaging, `private` media, games on, AI off | PASS |
| M9 | Legal acceptance | terms + privacy, accepted by the guardian | both rows, `accepted_by = parent` | PASS |
| M10 | Privacy | minor floor | `private`, AI processing and training off | PASS |
| M11 | Platform status | usable immediately | `active`, not locked | PASS |
| M11b | Audit trail | every row names the guardian | `managed.created`, `link.active`, `controls.created`, `consent.required`, `consent.approved` — all `actor = parent` | PASS |
| M11c | Notifications | one per child, no duplicate | 1 for the under-13 (consent trigger), 1 for the 16–17 ("Child profile added") | PASS |

## The child's existing controls still apply

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M12a | `minor_messaging_allowed(child, stranger)` | false | false | PASS |
| M12b | `minor_messaging_allowed(child, parent)` | true | true | PASS |
| M12c | `child_game_participation_allowed(child)` | true | true | PASS |
| M12d | `is_guardian_of(parent, child)` | true | true | PASS |
| M13 | Anonymous / stranger reads the child's profile | nothing | `0` rows / `0` rows | PASS |
| M13b | Child changes their own birthday | refused | `BIRTHDAY_LOCKED` | PASS |

## Guards

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M14 | `managed_accounts` read by parent / child / stranger | own rows only | all the parent's / 1 / 0 | PASS |
| M15 | Parent inserts into `managed_accounts` directly | refused | `42501 permission denied` | PASS |
| M16 | Parent ends the family link with a managed child | refused | `MANAGED_CHILD_DELETE_INSTEAD` | PASS |
| M17 | Deleting the parent's auth user while they manage a child | refused by the database | foreign-key violation on `managed_accounts_managed_by_fkey` | PASS |
| M18 | Deleting the child's auth user | cascades | `managed_accounts`, profile, birthday, link, controls all gone | PASS (see note) |
| M19 | Signed-in insert / update on `player_profiles` | refused | `42501 permission denied` for both | PASS |

Note on M18: the test deleted the auth user directly. `legal_consents` rows and
the `account_profiles` player row are not foreign-keyed to `auth.users`, so a
direct delete leaves them — true for every account today, not only managed
children. The app's delete path (`purgeUserAccount`) now removes the
`account_profiles` rows explicitly; `legal_consents` rows are kept as the
consent record, as before.

## Still to run on the live backend

Run these once Lovable has applied both migrations, against the dev/E2E project
first, with real user tokens as in the earlier verification documents:

1. `admin.createUser` accepts an `@managed.invalid` address with no password,
   and `auth.admin.generateLink({ type: 'magiclink' })` returns a
   `hashed_token` **without** calling the send-email hook.
2. M1–M19 above through the Data API.
3. `startManagedSession`: refused for an unrelated adult, for a managed child's
   own token, and for a child with their own login (`NOT_MANAGED`); the returned
   token redeems with `verifyOtp({ type: 'email' })` into the child's session.
4. Sections E and F of the final-verification document with a managed child as
   the subject.
5. `e2e/managed-child.spec.ts` (it skips itself until the migration is present).

## Known limitations

- A child session can call `updateUser({ password })` directly and give the
  account a working password; GoTrue has no server-side way to refuse it. The UI
  never offers it (Security settings are hidden, `/account/security` redirects),
  and every control still applies because the actor is still the child. An email
  change from a child session cannot complete as long as email changes require
  confirmation (the project's auth setting): the auth-email hook never sends mail
  for a placeholder address, so the confirmation link never arrives.
- The guardian's session is parked in the browser while they act as the child.
  If another tab rotates that refresh token outside Supabase's reuse window,
  switching back falls back to signing in again.
- Switching back to the guardian is one tap, not a lock. A PIN-protected kid mode
  is a possible later addition.
- Consent is recorded with method `email_confirmation` (the same as an invite
  accepted from a signed-in adult account) and scope
  `{guardian_attested: true}`. Counsel sign-off on the verifiable-consent method
  is still required (P0 in `child-teen-compliance-audit.md`).

This records observed behaviour of specific controls. It is not a legal
compliance certification for COPPA, GDPR-K or any other regime.
