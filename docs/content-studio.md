# Content Studio and claimable listings

Approval-first drafting and publishing to the official BallaCity Facebook Page,
connected to the existing unclaimed-listing and claim system. This document
records what exists, how it is enforced, what was verified and what is still
needed before production use.

## What exists

| Area                                                | Where                                                                                | Notes                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources (submitted links)                           | `content_sources`, `submitStudioSource`, `updateStudioSource`                        | Links are parsed and normalised, never fetched. Duplicate links map to one record.                                                                                                                    |
| Listings from sources                               | `linkStudioSourceToListing` + existing `createUnclaimedListing`                      | Creates an _unclaimed_ team or gym; a real owner claims it.                                                                                                                                           |
| AI drafts                                           | `generateStudioDraftWithAi`, `content-studio.server.ts`                              | Shared AI gate, new adults-only `content_studio` feature, safety-screened.                                                                                                                            |
| Manual drafts and edits                             | `createStudioDraft`, `updateStudioDraft`                                             | Links must be `https://ballacity.com`.                                                                                                                                                                |
| Approval                                            | `approve_content_draft` / `reject_content_draft`                                     | Superadmin only. Bound to an exact version and its sha256.                                                                                                                                            |
| Publishing                                          | `publishStudioDraft` → `begin_content_publish` / `finish_content_publish`            | Superadmin only, off by default, needs Meta credentials.                                                                                                                                              |
| Page connection                                     | `startMetaConnect`, `/api/public/content-studio/meta-callback`, `disconnectMetaPage` | Meta OAuth. Tokens encrypted server-side.                                                                                                                                                             |
| Settings                                            | `app_settings.content_studio`                                                        | Discovery, AI drafts, publishing, listing creation. Publishing defaults to off.                                                                                                                       |
| UI                                                  | Superadmin → **Content studio** tab                                                  | Sources, drafts and approval, published log, Page and settings.                                                                                                                                       |
| Claims                                              | `20261022130000_listing_claim_review.sql`, `ClaimListingCard`, `ListingsClaimsPanel` | Relationship, attestation, needs-info, no self-review.                                                                                                                                                |
| Web listing discovery (separate, already on `main`) | `listing_candidates`, Superadmin discovery tab                                       | Finds teams, gyms and trainers on the open web and OpenStreetMap. Studio sources are submitted links for content. Both create listings only through `create_unclaimed_team` / `create_unclaimed_gym`. |

## Who can do what

Every rule below is enforced on the server and in the database. The UI only
reflects it.

| Action                                                               | Who                                                  | Enforced by                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Read the studio                                                      | Staff (`is_moderator`: admin, moderator, superadmin) | RLS `staff read …` policies; server fns `assertStaff`                     |
| Submit or edit sources, write drafts                                 | Staff                                                | Server fns (service role); no client write grants exist                   |
| Approve, reject, publish, pick the destination Page, change settings | Superadmin                                           | Definer routines check `is_superadmin(auth.uid())`; server fns check too  |
| Record a publish result                                              | Server only                                          | `finish_content_publish` is executable by `service_role` only             |
| Read a Page token                                                    | Nobody through the API                               | `social_page_tokens` has no grants or policies for `anon`/`authenticated` |
| File a claim                                                         | Any signed-in user                                   | `submit_listing_claim_details`                                            |
| Review a claim                                                       | A moderator who is **not** the claimant              | `OWN_CLAIM` check in approve, deny and request-info                       |

A verified listing claim makes the claimant the owner of that BallaCity listing
only. It grants no Facebook access, no access to other listings, and no way
around moderation or youth-safety controls. Ownership still changes only inside
`approve_listing_claim`, guarded by `guard_listing_owner_change`.

## How a post goes out

1. A staff member submits a link. The server rejects anything that is not a plain
   public http(s) address: credentials, IP literals, `localhost`, single-label
   hosts, non-standard ports and other schemes. Because the link is never fetched,
   there is no server-side request forgery surface.
2. Staff enter the details by hand and tick which ones they confirmed.
3. A draft is written by hand, or by the AI from those details only. The prompt
   treats details as data, forbids invented facts and affiliation claims, and
   labels each detail verified or unverified. Every AI-listed fact starts as
   `suggested`; only a person can mark it verified.
4. A superadmin approves **the version on screen**. If any fact is unverified,
   the server refuses unless the approver explicitly acknowledges it.
   `approve_content_draft` stores an immutable snapshot plus its sha256, for the
   current destination Page.
5. Any later edit to the message, link, hashtags or channel bumps the version
   and withdraws the approval (database trigger). It has to be approved again.
6. Publishing calls `begin_content_publish` with an idempotency key. It refuses
   if the live draft no longer hashes to the approval, or the destination Page
   changed. Only the request that created the attempt contacts Meta, so a double
   click or a retry cannot post twice.
7. The server posts the approved payload to `POST /{page-id}/feed` and records
   the result. "Published" is recorded only with the post id Meta returns. A
   timeout is reported as unconfirmed, and the reviewer is told to check the Page
   before retrying.

**Not available, and shown as such:** scheduling (there is no worker for it yet)
and reach or engagement metrics (no Meta insights integration). Nothing is
simulated.

## What remains outside the code

### Meta (needs the owner)

1. Create or choose a Meta app for BallaCity and add the Facebook Login product.
2. Request `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`.
   Posting to a Page needs **Meta App Review** for `pages_manage_posts`. Until it
   is approved, only app admins, developers and testers can connect.
3. Register the redirect URI:
   `https://ballacity.com/api/public/content-studio/meta-callback`, or set
   `META_REDIRECT_URI` for another host.
4. Connect from Superadmin → Content studio → Page & settings, with an account
   that manages the official BallaCity Page, then press **Make destination**.

Reading other people's Facebook posts is not implemented and not planned:
Meta offers no authorized way to read arbitrary public posts for this purpose.
Discovery is user-submitted links only.

### Server environment (no values here)

| Variable                   | Purpose                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `META_APP_ID`              | Meta app id                                                                                         |
| `META_APP_SECRET`          | Meta app secret (server only)                                                                       |
| `CONTENT_STUDIO_TOKEN_KEY` | 32 random bytes, base64. Encrypts Page tokens (AES-256-GCM). Losing it means reconnecting the Page. |
| `META_REDIRECT_URI`        | Optional; defaults to the ballacity.com callback                                                    |

Without the first three, connecting and publishing are disabled, and the UI
says so.

## Deployment

The two migrations are additive and ship like every other migration file (applied
through Lovable; never by hand on the canonical project):

- `drizzle/migrations/0023_content_studio.sql`: new tables, policies and routines
  only. (This was also committed as an identical `supabase/migrations` file, which
  made a replay fail with "relation already exists"; only the drizzle copy, the one
  Lovable applied, is kept.)
- `supabase/migrations/20261022130000_listing_claim_review.sql`: new nullable claim columns, one
  widened CHECK (adds `needs_info`), the one-open-claim index widened to cover it,
  three new routines, and four existing claim routines replaced with the same
  bodies plus the new checks.

Each file's header lists its rollback steps. Publishing stays off until a
superadmin turns it on after Meta is set up.

## Verification

**Database.** `bun run test:db` replays the whole chain on a blank Postgres 16
(Supabase migrations and Drizzle migrations, in timestamp order) and runs every
file in `supabase/tests`. Result: **210 passed, 0 failed**. That includes the
existing suites and the schema invariants (RLS on every table, `search_path`
pinned on every definer function, the anonymous allow-lists).

- `supabase/tests/60_content_studio.test.sql` covers reads by role, token
  isolation, approval by role and version, the approval hash, immutability, an
  edit withdrawing the approval, version forgery, the single-publisher rule,
  locking during and after publishing, failure and retry, a destination change
  and the audit trail.
- `supabase/tests/70_listing_claim_review.test.sql` covers no self-review,
  relationship and attestation, immutability after filing, duplicate and
  competing claims, the needs-info round trip, approval declining rivals, owner
  takeover still blocked, and the legacy path.

Two defects were found by running these, and fixed before merge:

- **Self-approval.** In the existing claim code, a moderator could list a team,
  claim it, approve their own claim and become its owner. This was reproduced
  first, then fixed.
- **Leaking flag.** The workflow flag was left on for the rest of the transaction
  after a privileged write, so a later statement in the same transaction could
  forge a draft's version. Each routine now switches it off straight after its
  write. This was not reachable through the API (one request is one
  transaction), but it was fragile.

**Application.**

| Check                                 | Result                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| `tsc --noEmit`                        | clean                                                    |
| `vitest run`                          | 1575 passed, 22 skipped (backend-only integration specs) |
| `eslint` on every new or changed file | no new problems                                          |
| `vite build`                          | passes with `NODE_OPTIONS=--max-old-space-size=8192`     |

The default 2 GB Node heap runs out during `vite build` in this environment, and
current `main` fails the same way without these changes. Lovable's build
environment may differ.

**Not verified.** Nothing was sent to Meta: no real OAuth exchange and no real
post. The Graph calls are tested against mocked responses only. No production
data was read or changed.

## Not done, and why

| Item                            | Why                                                                                                                                                                                                       | What it needs                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Revoking an approved claim      | It takes ownership away from a live team or gym. The owner row, roster membership and account profile created on approval would all need unwinding, and roster membership controls messaging with minors. | An agreed design for what happens to the roster and profile, then the same replay-and-test treatment |
| Disputes that freeze management | Freezing an owner's edits means changing RLS on `teams` and `trainer_orgs`.                                                                                                                               | A decision on what a dispute freezes                                                                 |
| Private evidence uploads        | Claims take a public link today. A private bucket needs storage policies and a retention rule.                                                                                                            | A retention decision                                                                                 |
| Listing-manager dashboard       | Owners already manage claimed teams and gyms through the existing team and org pages.                                                                                                                     | Confirmation that a separate dashboard is wanted                                                     |
| Scheduling                      | No worker exists to publish at a set time.                                                                                                                                                                | A scheduled job (cron) with the same `begin_content_publish` path                                    |
| Moderator access to the studio  | The studio lives in the superadmin console. Moderators have the server permissions, but no screen.                                                                                                        | A decision to mount it in `/admin` too                                                               |
