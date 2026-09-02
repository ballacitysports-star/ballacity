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
| Logs & audit | Diagnostics ~90 days; admin audit append-only | Diagnostics unlinked; audit untouched | Yes |
| Payments | Financial record-keeping (~7 years, TBD) | Payout handles deleted; receipts kept | Yes |

Nothing is purged automatically from this configuration. Account deletion is user-triggered via
`deleteMyAccount` in `src/lib/account.functions.ts`; anything that legitimately survives it is
listed above and shown to the member before they confirm.

## Security properties

- `data-exports` is a private bucket with **no** `storage.objects` policies, so neither `anon`
  nor `authenticated` can read or write it directly. Only the service role (server functions)
  writes files and mints signed URLs.
- `data_export_requests` RLS: members may read only their own rows and may insert only rows for
  themselves with `status = 'requested'` and `storage_path IS NULL`. Status transitions and
  `storage_path` are written exclusively server-side.
- `getDataExportDownloadUrl` re-verifies ownership, status, and expiry before signing, and flips
  a lapsed row to `expired` instead of signing it.
