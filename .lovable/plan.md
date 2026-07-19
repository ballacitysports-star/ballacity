
## Goal

Give users, trainers, teams and organizations a consistent way to upload an **avatar** and a **cover image**, with an in-app advanced editor: crop/zoom (already exists), rotate & flip, free-rotate straighten, brightness/contrast/saturation adjustments + preset filters, and AI background removal (avatars).

## Storage — separate buckets per entity

New Supabase Storage buckets (private, signed URLs via public read policy):

- `avatars/{user_id}/…` — personal avatars
- `covers/{user_id}/…` — personal covers
- `trainer-avatars/{trainer_id}/…`
- `team-covers/…` — already exists, keep as-is for team covers
- `team-avatars/{team_id}/…` — team/logo
- `org-avatars/{org_id}/…` and `org-covers/{org_id}/…`

RLS on `storage.objects`:
- Public SELECT on all image buckets (needed for `<img src>`).
- INSERT/UPDATE/DELETE restricted to the owner: for user-scoped buckets `auth.uid()::text = (storage.foldername(name))[1]`; for entity-scoped buckets, a helper checks `teams.created_by = auth.uid()` (and org owner/admin membership for org buckets).
- 4 MB size cap, `image/jpeg|png|webp` mime allowlist enforced in the client + server function.

Migration also adds `avatar_url` / `cover_url` columns where missing:
- `profiles`: already has avatar; add `cover_url text`.
- `teams`: already has `avatar_url`/`cover_url` (reused for trainer & team).
- `trainer_orgs`: add `avatar_url text`, `cover_url text`.

## Advanced image editor

Refactor `ImageCropperDialog` into a new `ImageEditorDialog` that keeps the current crop/zoom/pan and adds a bottom tab bar:

1. **Crop** — existing behavior (aspect enforced per surface: 1:1 avatar, 16:9 cover, circle mask for avatar).
2. **Transform** — 90° rotate left/right, horizontal flip, vertical flip, and a **straighten slider** (−45° … +45°) with automatic inner-crop so no transparent corners remain.
3. **Adjust** — sliders for brightness, contrast, saturation (CSS filter live preview, baked into the canvas on export).
4. **Filters** — preset chips (Original, Mono, Warm, Cool, Vivid, Fade, Noir) implemented as `filter:` strings; also baked into export.
5. **Background** (avatars only) — “Remove background” button. Calls a new `removeAvatarBackground` server function that uses Lovable AI Gateway `google/gemini-2.5-flash-image` (edit mode: input image + prompt "remove background, transparent PNG") and returns a base64 PNG. Shown as a toggleable layer over a checkerboard so the user can revert.

All transforms compose into a single export canvas at Done: rotation → straighten → crop rect → filter/adjust bake → JPEG (or PNG when bg-removed) at the chosen size/quality preset (existing S/M/L + Standard/High/Max controls stay).

Files:
- `src/components/ImageEditorDialog.tsx` (new, replaces `ImageCropperDialog`; keep old file exporting a thin wrapper for backward compat).
- `src/lib/image-filters.ts` (new): presets, filter string builder, `bakeFiltersToDataUrl(img, transform, filter, adjust, cropRect, output)`.
- `src/lib/bg-remove.functions.ts` (new): `removeBackground({ dataUrl })` server fn using `LOVABLE_API_KEY`.

## Reusable uploader

Generalize `TeamCoverUploader` → `ImageUploader` with props: `bucket`, `pathPrefix`, `shape` (`circle`|`rect`), `aspect`, `allowBgRemoval`, `presets?`. Under the hood it opens `ImageEditorDialog`, uploads the resulting Blob to the given bucket via `supabase.storage.from(bucket).upload(...)`, and returns the public URL.

Wire two instances (avatar + cover) into:
- `src/routes/profile.edit.tsx` (user)
- `src/routes/trainers.$trainerId` edit path (`src/routes/teams.$teamId.edit.tsx` with `kind=trainer`)
- `src/routes/teams.$teamId.edit.tsx` (team)
- `src/routes/orgs.$orgId.tsx` owner-only settings panel (add a small “Edit branding” sheet if none exists)

`CreateTrainerWizard` and `teams.create.tsx` get the same avatar + cover controls in their branding step (cover already there — swap for the new component; add avatar).

## Out of scope

- No changes to messaging, reels, or post attachments.
- No new AI features beyond background removal.
- Video/GIF assets.

## Technical notes

- All uploads go through the browser Supabase client (signed-in user), no new server routes required except the AI bg-removal server function.
- Straighten math: rotate source, then compute the largest axis-aligned rectangle fitting inside the rotated image bounds for a given aspect (standard `rotated inner rect` formula) before applying the user's crop.
- Adjustments/filters are baked with an offscreen canvas + `ctx.filter = "..."` so the exported file matches the preview (Safari 16+ supports canvas `filter`).
- BG-removal round-trip: send the cropped-but-un-baked image data URL to the server fn; response replaces the working image; export uses PNG when the alpha channel is present.
- Reuse existing `loadNormalizedDataUrl` for EXIF orientation.
- Keep the existing size (S/M/L) and quality presets on the export bar.
