## Context

`/teams/create` already exists as a 4-step wizard (Type → Identity → Details → Branding) that collects name, handle, sports, city, bio, and branding, then calls `addOrg()` and redirects to `/teams/$teamId`. Two of the fields you asked for are missing:

- **Skill range** — not captured anywhere on the `Org` type.
- **Team photo** — the "Cover image" step only lets users pick from 6 preset sport images; no upload.

Redirect-after-create already works, and name/sport/location are already there.

## Plan

1. **Extend the `Org` type** (`src/lib/sample-data.ts`)
   - Add optional `skillRange?: { min: number; max: number }` where 1 = Beginner and 5 = Pro.

2. **Add "Skill range" field to Identity step** (`src/routes/teams.create.tsx`)
   - Dual-thumb-style min/max via two selects or a compact range control with labels: Beginner · Recreational · Intermediate · Advanced · Pro.
   - Default: 2–4 (Recreational to Advanced).
   - Include in `handlePreview` and the submitted `Org`.

3. **Add photo upload to Branding step**
   - New "Team photo" control above the preset picker:
     - "Upload photo" button (hidden `<input type="file" accept="image/*">`).
     - Reads via `FileReader.readAsDataURL()` → sets `cover` state to the data URL (same pattern already used for `updateStaffAvatar`).
     - Client-side validation: image mime type, ≤ 4MB (reject with inline error).
     - Show a "Remove" button when a custom upload is active to revert to the sport preset.
   - Presets remain as a fallback grid below.

4. **Surface skill range on the team page** (`src/routes/teams.$teamId.tsx`)
   - Small pill under the tagline showing "Skill: Recreational–Advanced" when set. Read-only display only; no other logic changes.

5. **Keep redirect behavior**
   - `submit()` already navigates to `/teams/$teamId` with the new id — no change.

## Out of scope

- No database work: teams still live in the in-memory `org-store` (matches the rest of the teams feature).
- No changes to the edit-team route (can follow in a separate pass if you want parity).
- No image cropping — plain upload + preview.

## Technical details

- File-size guard: reject `file.size > 4 * 1024 * 1024` before reading.
- Skill labels array lives in `teams.create.tsx` as a local const; the numeric min/max is what gets stored so it's easy to render/sort later.
- No new dependencies.
