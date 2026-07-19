
## Goal

Replace every ad-hoc image picker in the create/edit wizards with the same advanced `ImageEditorDialog` (crop, transform, adjust, filters, AI bg-removal) plus a public-bucket upload, so avatars and covers behave identically for users, trainers, teams, gyms/orgs, and games.

## New shared component

`src/components/ImageUploader.tsx` — the single control every wizard uses.

Props:
- `kind`: `"avatar" | "cover"` (drives shape/aspect/preset behavior)
- `value`, `onChange(url)` — current URL
- `bucket`, `pathPrefix` — where the file lands (e.g. `avatars` + `userId`)
- `fallback` — placeholder shown when no value
- `presets?: Sport[]` (covers only) — reuse `imageFor(sport)` chips
- `allowBgRemoval?: boolean` (default true for avatar)

Internally:
- Circular preview + "Upload / Change / Remove" for avatar; 16:9 preview for cover
- Opens `ImageEditorDialog` with aspect `1` or `16/9`, `shape` circle/rect, `outputMaxSize` 512 (avatar) / 1600 (cover)
- On confirm → `uploadDataUrlToBucket(bucket, pathPrefix, dataUrl)` → `onChange(url)`
- Inline upload progress + error state (same visual language as current `TeamCoverUploader`)

This replaces both `TeamCoverUploader` and the inline avatar pickers. `TeamCoverUploader` becomes a thin re-export for back-compat.

## Wizard integrations

Each wizard gets an **Avatar** + **Cover** control in its Branding step, wired to the appropriate bucket. `pathPrefix` uses the owner/entity id so RLS accepts the write.

| Wizard / route | Avatar bucket / prefix | Cover bucket / prefix | Field(s) written |
|---|---|---|---|
| `profile.edit.tsx` (user) — already done, refactor to `ImageUploader` | `avatars/{userId}` | `covers/{userId}` | `profiles.avatar_url`, `profiles.cover_url` |
| `create/CreateTrainerWizard.tsx` (Branding step near line 200) | `trainer-avatars/{userId}` (temp id pre-create, moved on save) | `team-covers/{userId}` | `teams.avatar_url`, `teams.cover_url` (kind=coach) |
| `teams.$teamId.edit.tsx` — trainer & team | `trainer-avatars` or `team-avatars` / `{teamId}` | `team-covers/{teamId}` | `teams.avatar_url`, `teams.cover_url` |
| `CreateOrgWizard.tsx` — team & gym/org branding (line 1169/1181) | `team-avatars` (team) or `org-avatars` (org) / `{userId}` pre-create | `team-covers` / `org-covers` | `teams.*` or `trainer_orgs.avatar_url`, `trainer_orgs.cover_url` |
| `orgs.$orgId.tsx` — add owner-only "Edit branding" sheet | `org-avatars/{orgId}` | `org-covers/{orgId}` | `trainer_orgs.*` |
| `_tabs.create.tsx` (game creation) | — (games have no avatar) | `game-covers/{userId}` via `ImageUploader` (replaces inline file input at lines 56–370) | `hosted_games.cover_url` (already `image` field) |

For pre-create wizards (Trainer/Org/Team/Game) the `pathPrefix` uses `auth.uid()` so RLS passes; after the row is inserted, no rename is needed — the URL is already public and stored on the row.

## Bucket / RLS notes

All six buckets and RLS policies from the previous turn already exist. No new migration needed unless we add an owner-branding sheet for orgs that writes to `trainer_orgs` — that only needs the existing `is_trainer_org_admin` check on `org-avatars`/`org-covers` (already in place).

## Out of scope

- No new AI features beyond existing bg-removal.
- No changes to games/roster/messaging.
- Staff member avatars inside `CreateOrgWizard` (line 969) stay as-is (uses initials/dataurl paste flow).

## Technical details

- `ImageUploader` is a client component, imports `ImageEditorDialog` lazily to keep initial bundles small on wizards that only sometimes open it.
- Reuse `loadNormalizedDataUrl` for EXIF orientation on the file input.
- Public URL comes back from `supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl`; no signed-URL bookkeeping.
- All wizard state stays local until "Save"; only the storage upload is eager (needed to preview edited image). Removing/replacing before save leaves an orphan blob — acceptable for now, can be swept later.
- Type: extend `CreateTrainerWizard` draft with `avatarUrl?: string | null; coverUrl?: string | null` and persist through `useDraftPersistence`.

## Files touched

- Add: `src/components/ImageUploader.tsx`
- Edit: `src/components/TeamCoverUploader.tsx` (re-export wrapper)
- Edit: `src/components/create/CreateTrainerWizard.tsx` (Branding step)
- Edit: `src/components/CreateOrgWizard.tsx` (replace TeamCoverUploader + add avatar)
- Edit: `src/routes/teams.$teamId.edit.tsx` (both trainer & team edit views)
- Edit: `src/routes/orgs.$orgId.tsx` (add owner branding sheet)
- Edit: `src/routes/_tabs.create.tsx` (game cover)
- Edit: `src/routes/profile.edit.tsx` (swap direct ImageEditorDialog usage for ImageUploader for consistency)
