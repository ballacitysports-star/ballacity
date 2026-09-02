# OpenRun — Child / Teen Privacy & Safety Implementation Audit

**Not a legal compliance certification.** This documents the technical controls now in the
codebase and flags every item that requires review by qualified legal counsel or a business
policy decision.

## A. COPPA readiness (technical controls)

| Requirement | Status | Notes |
| --- | --- | --- |
| Age screen / neutral DOB collection | GREEN | `BirthdayInput` + `age_cohort_from_birthday`, no age gate rejection |
| Age cohorts (under 13 / 13–15 / 16–17 / 18+) | GREEN | `src/lib/child-policy.ts`, thresholds from `app_settings.age_policy` |
| Under-13 supported (not blocked) | GREEN | `/onboarding/child` child-safe flow |
| Pre-consent data minimization | GREEN | Child onboarding collects display name + guardian email only; DB triggers block games/messages/reels/availability while locked |
| Parental consent request + audit trail | GREEN | `parental_consents`, `parental_consent_events`, `guardian_links` |
| Verifiable consent *method* | YELLOW | Infrastructure is method-agnostic (`consent_method` column, `CONSENT_METHOD_META`). Current default is email confirmation by a signed-in adult account. **Legal counsel must approve the mechanism** (e.g. approved third-party verification vendor) before under-13 launch |
| Direct notice to parent | YELLOW | Consent page states scope, collection, controls; wording needs counsel review |
| Parent access / correction / deletion | GREEN | `/parent` Parent Center + `parent_requests` workflow |
| Consent revocation applies restrictions | GREEN | `revoke_parental_consent` flips state; `child_features_locked` gates messaging, reels, hosting, availability server-side |
| No conditioning participation on excess data | GREEN | Optional fields remain optional |
| No targeted ads / behavioral tracking for minors | GREEN | `trackingAllowed()` returns all-false for every minor cohort |
| No child data for AI training | YELLOW | Opt-in defaults off and disclosed; vendor contract terms require counsel review |
| Retention schedule | YELLOW | `docs/data-retention.md` exists; child-specific retention periods need policy sign-off |

## B. Georgia

**Current requirements addressed technically:** minor privacy defaults, parental controls for
under-16 where configured, no targeted advertising to minors, reporting/blocking access,
account and data deletion, legal document versioning with consent records.

**Future / pending (architecture supports, not switched on):** under-14 restrictions,
14–15 parental consent, under-16 verification, recommendation limits. All exposed as
configurable switches in `app_settings.age_policy` and read through
`age_policy_flag()` / `age_policy_number()` — no code rewrite needed to turn them on.

**Legal questions:** which verification method satisfies "verifiable parental consent";
whether 13–15 consent is required today in Georgia; jurisdiction determination method
(self-declared state vs. inferred); retention minimums; whether school-affiliated teams
create additional obligations.

## C. Child data map (summary)

| Data | Collection point | Storage | Third party | Retention | Deletion |
| --- | --- | --- | --- | --- | --- |
| Birthday | Onboarding | `profile_birthdays` (private, RPC-only) | none | account life | account deletion |
| Age cohort | Derived trigger | `profiles.age_cohort` | none | account life | cascade |
| Display name / username | Onboarding | `profiles` | none | account life | scrub on delete |
| Guardian name / email | Child onboarding | `parental_consents` | email provider (delivery) | consent life + audit | revocation + deletion workflow |
| Location | Profile / availability | `profiles`, `player_availabilities` | Maps (geocode) | account life | generalized for minors, cascade delete |
| Messages | Chat | `messages` | none | account life | cascade |
| Reels / video | Upload | Storage bucket + `highlight_reels` | AI model provider (opt-in only) | account life | cascade + storage delete |
| Push identifier | Notifications opt-in | `notification_preferences` | OneSignal | until opt-out | removed on delete |
| Payment proof | P2P pay | Storage (private) | none | dispute window | cascade |

## D. Parental consent flow

Child DOB entered → cohort `child_under_13` → child-safe onboarding collects minimum data →
guardian email + hashed one-time token issued (`request_parental_consent`) → guardian opens
`/parent/consent/$token`, signs in with an adult account, reviews scope and acknowledges →
`approve_parental_consent` records method, timestamp, scope and policy/terms/privacy versions →
`guardian_links` created, child unlocked → guardian manages controls at `/parent` →
`revoke_parental_consent` re-locks features immediately → deletion request via
`parent_requests` runs the scrub-and-cascade workflow.

Consent status, guardian identity, verification state, timestamps and scope are written only by
`SECURITY DEFINER` functions; children and clients cannot modify them.

## E. Feature permission matrix

Implemented in `PERMISSION_MATRIX` (`src/lib/child-policy.ts`) with 32 tests. Precise location
is never public for any minor cohort; DM and public reels are restricted under 16; game hosting
is adult-only; AI analysis is guardian-controlled for under-13.

## F. Security findings

- Consent/guardian tables: RLS scoped to child self-read and linked guardian only; writes via
  definer functions. Verified.
- `anon` EXECUTE revoked on all new child-safety functions.
- Pre-existing (intentional, accepted for anonymous browsing): `visible_avatars`,
  `public_privacy_flags`, `profile_visibility_of` remain anon-executable and return only
  non-PII, privacy-filtered fields.
- Frontend gates (`ChildConsentGate`) are explanatory only; every restriction is duplicated in
  DB triggers/policies.

## G. Third parties receiving (or potentially receiving) child data

Supabase (DB/auth/storage), email delivery, OneSignal (push), Google Maps (geocoding),
AI model provider (reel analysis, opt-in only), Stripe (premium — adults only).
DPAs / child-data terms for each require legal review.

## H. Remaining gaps

- **P0** — Approve and configure a legally sufficient verifiable-consent method before enabling
  under-13 signups in production.
- **P0** — Counsel review of the children's privacy notice and parent direct-notice wording.
- **P1** — Decide whether 13–15 requires parental consent in Georgia and flip the switch.
- **P1** — Child-specific retention periods documented and enforced by a scheduled job.
- **P2** — Guardian identity verification beyond adult-account email confirmation.
- **P3** — Optional third-party age assurance; no biometric method implemented (deliberate).

## What is technically implemented vs. what needs a decision

**Implemented:** cohort engine, configurable jurisdiction policy, child onboarding, consent
request/approve/revoke with audit trail, server-side feature locks, minor privacy floor,
messaging restrictions, location generalization, reel privacy defaults, no minor tracking,
Parent Center, safety center, moderator dashboard, deletion workflow, versioned legal consents,
532 passing tests.

**Requires legal counsel / business policy:** consent verification mechanism, notice wording,
which cohorts need consent in which jurisdictions, retention periods, third-party DPAs, and any
AI-training authorization.

## Age-policy refactor (all cohorts supported)

- `src/lib/age-policy.ts` is now a thin compatibility layer over
  `src/lib/child-policy.ts`. There is no 13+ signup block: `MINIMUM_ACCOUNT_AGE`
  is 0 and `validateAgeMinimum` only rejects impossible dates.
- Under-13 birthdays are valid and surface `CONSENT_REQUIRED_MESSAGE` inline;
  finishing onboarding routes the member to `/onboarding/child` for the
  DOB → parent info → consent → activation flow.
- Cohort thresholds, jurisdiction and minor protections are configured in
  Superadmin → Youth (age policy) and stored in `app_settings.age_policy`,
  the same row the SQL helpers `age_policy_flag()` / `age_policy_number()` read.
- Username PII detection (`checkChildUsername`) runs in the shared basics
  fields and in `validateProfileSafety`, used by both onboarding and
  Edit profile, mirroring the `minor_handle_unsafe` database trigger.
- Host-selectable game age floor lowered to 5 so youth games are expressible;
  under-13 participation stays gated by parental consent and parent controls.

## Phase 1 closeout (2026-09-02)

Verified end-to-end as already enforced server-side: cohort derivation
(`sync_age_category_from_birthdays`), consent lifecycle
(`request_parental_consent` / `approve_parental_consent` /
`revoke_parental_consent`), guardian controls (`set_child_controls`),
child game-participation gates, minor handle safety, minor privacy floor,
and DOB-escalation protection (a change to a higher-privilege cohort keeps
the previous cohort, flags `age_review_required`, logs `age_change_events`,
and notifies the member plus guardians).

Closed in this phase:
- RLS gap: guardians could not read their own child's `parental_consent_events`
  or `age_change_events`. Added two guardian SELECT policies scoped by
  `is_guardian_of`.
- Transparency surfaces: `listMyAgeChangeEvents` + `AgeReviewNotice` (Settings),
  `getChildConsentTrail` + `ConsentTrail` (Parent Center approval history).
- E2E coverage: `e2e/child-lifecycle-cohorts.spec.ts` asserts the gate for
  under-13 required/pending/approved/revoked plus 13-15, 16-17 and adult, and
  that a blocked child can still reach the consent and safety pages.

Remaining legal/product decisions (not engineering blockers):
- The verifiable-consent method (`email_confirmation` via a signed-in adult
  account) requires counsel sign-off; `third_party_verified` is wired for a
  provider integration.
- Consent re-verification interval (`consent_reverification_days`) defaults to
  0 (never) and is a policy choice.
- Guardian "Request deletion" creates a `parent_requests` row handled by a
  moderator; a fully automated child-deletion pipeline is intentionally
  human-reviewed.

Manual QA required: real guardian email delivery of the approval link (the link
is currently surfaced in-app for the child to hand over), and an authenticated
direct-API probe per child table with a non-guardian token.
