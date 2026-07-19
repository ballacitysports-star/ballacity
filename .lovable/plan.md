## Goal

The Edit button on a trainer profile currently opens a 3‑step editor (Identity / Details / Branding) that is missing several fields the create‑trainer wizard collects. Make edit show **everything** from the create flow so trainers can change any answer they gave at creation.

## What's missing today (coach kind)

Comparing `src/components/create/CreateTrainerWizard.tsx` (4 steps) to `src/routes/teams.$teamId.edit.tsx` (3 steps):

| Field | In create | In edit |
| --- | --- | --- |
| Name, handle, city, tagline | ✅ | ✅ |
| Primary sport (single) + additional sports | ✅ primary sport | ✅ but only multi‑select, no "primary" |
| Profile photo & cover on the basics step | ✅ | ❌ only on final Branding step |
| Bio | ✅ | ✅ |
| Session types (ChipPicker) | ✅ | ❌ |
| Credentials | ✅ | ✅ |
| Organization / Gym attach or create | ✅ | ❌ |
| Hourly rate | ✅ | ✅ |
| Skill range you work with | ✅ | ❌ |
| Venues (Google‑verified, primary star, map) | ✅ | ✅ (already parity) |
| Timezone | auto‑detect note | ✅ selector |
| Availability calendar + recurring rules | ✅ calendar | ✅ calendar + rules |
| Accent color, avatar initials | ❌ | ✅ (edit‑only branding) |
| Delete profile | ❌ | ✅ (edit‑only) |

## Plan

Rewrite `src/routes/teams.$teamId.edit.tsx` for the coach kind so its steps match the create wizard 1:1, then add the edit‑only extras (branding + delete) as a small final step. Team kind (`org.kind === "team"`) keeps today's 3‑step layout untouched.

### New coach step layout (5 steps)

```text
Step 1  Basics          name, handle, primary sport, extra sports,
                        city, tagline, year founded,
                        profile photo (ImageUploader avatar),
                        cover image (ImageUploader cover)
Step 2  Expertise       bio, session types (ChipPicker),
                        credentials, organization/gym picker,
                        hourly rate, skill range
Step 3  Venues          Google-verified venues list, primary star,
                        map previews (reuse current UI, drop the
                        "Session venues" section from Details step)
Step 4  Availability    timezone select, AvailabilityCalendar,
                        AvailabilityRulesEditor
Step 5  Branding        accent color, avatar initials, live preview,
                        delete-organization action
```

Progress bar, Back/Continue/Save footer, and `canNext` rules mirror the create wizard's validators (name+handle+sport+city on step 1, `bio.length ≥ 40` on step 2, at least one verified venue on step 3, availability optional on step 4).

### Field wiring

- **Primary sport**: reuse the existing `sports: Sport[]` array; treat `sports[0]` as primary and add UI to reorder. No schema change needed.
- **Session types**: hydrate from `org.sessionTypes`, save via existing `updateOrg({ sessionTypes })` (already mapped in `src/lib/org-store.ts`).
- **Skill range**: hydrate from `org.skillRange`, save via existing `skillRange` mapping.
- **Organization / Gym**: reuse the same search hook and `orgChoice` state shape from the create wizard. On save, call the existing `trainer-orgs.functions` join/create paths only when the choice changed vs. the current membership; otherwise no‑op. Show current membership status inline (owner / member / pending) so the trainer sees why the picker may be disabled.
- **Profile photo & cover on Basics**: move the two `ImageUploader` blocks currently in Branding into Basics for coach kind; keep accent + initials + live preview + delete in Branding.
- **Venues**: keep the current verified‑venue implementation (it already matches the create wizard's contract) and remove the duplicate "Session venues" block from the old Details step.

### Files touched

- `src/routes/teams.$teamId.edit.tsx` — split coach layout into 5 steps, add missing sections, adjust `STEPS`, `canNext`, and step‑switch UI.
- Reuse existing components as‑is: `ImageUploader`, `LocationAutocomplete`, `VenueMapPreview`, `AvailabilityCalendar`, `AvailabilityRulesEditor`, `TimezoneSelect`, `ChipPicker` (extract or import from create wizard).
- No DB schema changes. No changes to `org-store.ts` mapping (all target columns are already mapped).

### Out of scope

- Team‑kind editor stays as today (Identity / Details / Branding). If you want teams to also get a create‑style layout, that's a separate pass.
- No changes to the create wizard itself.

### Verification

After the change, re‑run the earlier end‑to‑end check against `/teams/<coachId>/edit`: step through all 5 screens, edit one field per step, save, and confirm the trainer profile reflects every change (bio, session types, org membership, skill range, venues, availability, avatar/cover, accent).
