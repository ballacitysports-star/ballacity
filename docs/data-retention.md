# ballaCity data export & retention

**LEGAL REVIEW REQUIRED** — durations below are engineering defaults, not vetted legal policy.

Canonical machine-readable source: `src/lib/retention.ts` (`RETENTION_RULES`) and
`src/lib/data-export.ts` (export categories + exclusions). The member-facing page at
`/account/data` renders both, so the docs, the UI, and the code cannot drift.

## Download my data

- Entry points: Settings → "Your data & retention", and Privacy → "Download my data".
- One request builds a single JSON file (`openrun-data-export/v1`) stored in the private
  `data-exports` bucket at `<user_id>/<request_id>.json`.
- Delivery is a signed URL valid for 1 hour; the export itself expires 24 hours after it is ready.
- Rate limit: 3 requests per rolling 24 hours, enforced by the
  `enforce_data_export_rate_limit` trigger on `data_export_requests` (server-side, not UI-only).
- Status machine: `requested → processing → ready | failed`, and `ready → expired`.
- The member is notified in-app when the export is ready or fails.

### Included categories

Profile information, preferences (privacy/notification/feed/AI), games created, games joined,
availability, reviews written, uploaded-media metadata, AI analysis metadata, safety records
(your blocks and reports you filed), legal acceptances, and payment records.

### Never included

Passwords and password hashes, session tokens and API keys, other members' private data,
internal moderation notes and reviewer identities, admin audit entries, system credentials,
and payment credentials (ballaCity never stores card or bank details).

Every read in `src/lib/data-export.functions.ts` runs through the caller's RLS-scoped Supabase
client filtered on the caller's own id, so an export cannot contain another member's rows even
if a column list were wrong.

## Retention

| Category | Retention | On account deletion | Survives deletion |
| --- | --- | --- | --- |
| Account data | While active | Scrubbed, then deleted | No |
| Messages | No automatic expiry | Bodies/attachments cleared, row marked deleted | Yes (empty rows) |
| Reports & safety | Indefinite today | Kept without profile details | Yes |
| Uploaded media | While active | Files removed from every media bucket | No |
| AI analysis | With the clip; deletable any time | Deleted with the clip | No |
| Logs & audit | Diagnostics 90 days (daily purge); admin audit append-only | Diagnostics unlinked; audit untouched | Yes |
| Payments | Financial record-keeping (~7 years, TBD) | Payout handles deleted; receipts kept | Yes |

Only the diagnostics are purged automatically (below); nothing else in this table is. Account
deletion is user-triggered via `deleteMyAccount` in `src/lib/account.functions.ts`; anything that
legitimately survives it is listed above and shown to the member before they confirm.

Diagnostics are kept 90 days (WP 5.9, migration `20261129120000_diagnostics_purge.sql`).
`public.purge_diagnostics()` deletes the rows of `auth_signin_events`, `location_denial_events` and
`notification_delivery_log` whose `created_at` is more than 90 days old. The `purge-diagnostics` job
runs it daily at 03:37 UTC where pg_cron is installed. A run deletes at most 100,000 rows per table,
and a larger backlog drains over the following nights. Only the service role and the job can run
it. Deleted rows cannot be restored. Until the migration is applied to production, the promise is
not kept there. Applying it is the owner's go-ahead: the first deletion is the job's first run after
the apply.

### Tables not in the member-facing list

These tables are not in `RETENTION_RULES`, so `/account/data` does not show them.

| Table | What it holds | Retention | On account deletion |
| --- | --- | --- | --- |
| `app_error_events` | Scrubbed error reports. No user id, no IP, path only. | 30 days. `purge_app_error_events()` runs daily at 03:17 UTC (`purge-app-error-events` job). | Nothing to remove: rows carry no account link. |
| `session_activity` | Session start, last heartbeat and time zone. No pages or content. | No expiry. | Deleted (`src/lib/account-purge.server.ts`). |
| `game_invites` | Host invites to a game: status and an optional note (up to 500 characters). | No expiry. Deleted with the game. | The invitee's invites are deleted (foreign key to `auth.users`). Invites a deleted host sent stay with the game: `host_id` has no foreign key. |
| `late_cancellations` | Late leaves from games, tryouts and sessions: who, which event, how late. | No expiry. | **Kept, with the user id.** `user_id` has no foreign key, and the account purge does not delete these rows. |
| `private_sec.funnel_daily` | The pilot funnel's adult totals per New York day (WP 5.3). Counts only: no user, game or invite id (a check refuses anything else), no under-18 numbers. Not readable by any API role. | No expiry yet. Written nightly by `snapshot-funnel-daily` (08:47 UTC); a day is rewritten until it is three to four weeks old, then frozen. Stored days are deleted (and counted again live) when an adult counted in them is found to be a minor. Dropping it needs an export first (`docs/rollbacks/20261127110000_funnel_daily_history.down.sql`). | Nothing to remove: rows carry no account link. |

## Security properties

- `data-exports` is a private bucket with **no** `storage.objects` policies, so neither `anon`
  nor `authenticated` can read or write it directly. Only the service role (server functions)
  writes files and mints signed URLs.
- `data_export_requests` RLS: members may read only their own rows and may insert only rows for
  themselves with `status = 'requested'` and `storage_path IS NULL`. Status transitions and
  `storage_path` are written exclusively server-side.
- `getDataExportDownloadUrl` re-verifies ownership, status, and expiry before signing, and flips
  a lapsed row to `expired` instead of signing it.
