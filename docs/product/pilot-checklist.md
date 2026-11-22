# Pilot checklist

This page says whether the Phase 5 pilot can start. Plan: `docs/product/phase-5-validation-plan.md` (WP 5.0).

How to use it:

- Tick an item only when it is done. Write the date (YYYY-MM-DD) and who checked it. Use a role, such as "owner" or "counsel".
- If an item cannot be done yet, write "blocker" in Status and name an owner.
- The pilot starts when every item in section A is ticked. Teens join only when every item in section B is ticked too.
- Never write pilot users' names, emails or phone numbers here, or anywhere in the repo.

## A. Before the first pilot user

| #   | Item                                                                                                                                                                                     | Where to check                                                                                     | Owner | Date | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- | ---- | ------ |
| A1  | The pilot city is New York City. Game and reminder times show in `America/New_York`. Many other screens use the phone's time zone. Those match only while the phone is on New York time. | `src/lib/format.ts:3`; `src/lib/launch-cities.ts:37`                                               |       |      | [ ]    |
| A2  | The pilot start date is set. Pilot users are real accounts active after that date, minus `*@lovable.test` and staff accounts.                                                            | Plan, decision 5                                                                                   |       |      | [ ]    |
| A3  | `ONESIGNAL_REST_API_KEY` is set in production. One real push reached a real phone, sent from the Ops push test.                                                                          | `src/lib/push.server.ts:157`; Superadmin, Ops, "Push delivery test"                                |       |      | [ ]    |
| A4  | The legal documents are published in production `legal_documents`, or the owner accepts the placeholder banner.                                                                          | `src/components/legal/LegalDocumentBody.tsx:36-39`; `src/components/legal/LegalConsent.tsx:97`     |       |      | [ ]    |
| A5  | Counsel has answered whether GA4 needs a consent banner or a notice update. If GA must stop, that needs a code change: the id has a hard-coded fallback.                                 | Plan, decision 8; `vite.config.ts:51-53`                                                           |       |      | [ ]    |
| A6  | support@ballacity.app receives mail. Send a test message and see it arrive.                                                                                                              | `src/lib/trust.ts:11`                                                                              |       |      | [ ]    |
| A7  | Sandbox status is settled, and `schema_migrations` records the applies made through the SQL Editor.                                                                                      | `docs/release/sandbox-verification.md`; `docs/release/records/2026-11-21-batch-22.md` "Still open" |       |      | [ ]    |
| A8  | Production has `20261124100000` and `20261125100000` applied. The funnel report depends on which invite function is live.                                                                | `docs/release/records/`                                                                            |       |      | [ ]    |
| A9  | `seedTestAccounts` was never run in production, or its accounts and rows are removed. (It now refuses to run there.)                                                                     | `*@lovable.test` accounts in production; `docs/e2e-test-accounts.md`                               |       |      | [ ]    |
| A10 | Free Mode is on in production. Nothing is for sale during the pilot.                                                                                                                     | Superadmin, Monetization                                                                           |       |      | [ ]    |
| A11 | Pilot hosts agree to run free games. There is no switch for host-charged games.                                                                                                          | Plan, decision 13                                                                                  |       |      | [ ]    |
| A12 | A named person reads the moderation queue every day of the pilot. The superadmin AttentionStrip counts new reports. Its "New reports" chip opens `/admin/moderation` on the New filter.  | `/admin/moderation`                                                                                |       |      | [ ]    |
| A13 | WP 5.0 to 5.5 are shipped to production. Funnel history (WP 5.3) is live before the start date.                                                                                          | Plan, "Release gates and order"                                                                    |       |      | [ ]    |

## B. Teen gate: before any teen is recruited

Until every item here is ticked, recruit adults only. The funnel shows adults only, and its under-18 column stays hidden. Feedback from minors stays off (WP 5.7 and 5.8) until counsel approves it separately.

| #   | Item                                                                                                                                                                                | Where to check                                                                      | Owner | Date | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- | ---- | ------ |
| B1  | Counsel signs off, in writing, on counting minors in product metrics.                                                                                                               | Plan, "Owner decisions (2026-11-21)"                                                |       |      | [ ]    |
| B2  | Counsel signs off on the teen safety texts, and `LEGAL_REVIEW.safetyAcknowledgments` is set to `true` in a reviewed change.                                                         | `src/lib/legal-review.ts:14-19`                                                     |       |      | [ ]    |
| B3  | The guardian consent flow works end to end on a real phone: a teen signs up, the guardian gets the link, opens `/parent/consent/<token>`, approves, and the teen's account unlocks. | `src/routes/parent.consent.$token.tsx`; `docs/release/staging-test-checklist.md` §2 |       |      | [ ]    |
| B4  | The open youth privacy items are resolved or accepted by the owner.                                                                                                                 | `docs/release/privacy-gap-register.md`                                              |       |      | [ ]    |

## C. During the pilot

| #   | Item                                                                      | Where to check                            | Owner | Date | Status |
| --- | ------------------------------------------------------------------------- | ----------------------------------------- | ----- | ---- | ------ |
| C1  | Read the funnel weekly. Collect a 2-week baseline before setting targets. | Superadmin, Funnel card (WP 5.2)          |       |      | [ ]    |
| C2  | Ops flags marked "not enforced" are left alone. They change nothing.      | Superadmin, Ops, "Feature flags"          |       |      | [ ]    |
| C3  | At the end, write what the data showed and what to fix (WP 5.10).         | `docs/product/phase-5-validation-plan.md` |       |      | [ ]    |
