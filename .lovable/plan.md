## Goal

Turn the gym (org) profile into a Google Business Profile–style listing: place-search driven, with hours, contact, category/amenities, and photos — edited on a single page with a live listing preview and a profile-strength meter, and shown publicly as a Google-listing-style page.

## New listing fields

Added to the gym record:
- **Hours** — per weekday open/close ranges, "closed" and "open 24 hours" toggles; derived "Open now / Closed / Closes soon" status computed in the gym's timezone.
- **Contact** — phone number and public email (validated, tap-to-call / mailto on the public page).
- **Category + amenities** — one primary category (Gym, Fitness studio, Training facility, Court rental, Sports complex, Other) plus amenity chips (parking, showers, lockers, indoor courts, outdoor courts, weight room, turf, kids programs, accessible entrance, Wi-Fi).
- **Photos** — a gallery of up to 12 images in addition to logo and cover, with reorder and delete; first photo doubles as the listing hero if no cover is set.

## Editor (create + edit)

One scrolling page, same component used by `/orgs/create` and `/orgs/$orgId/edit`:

```text
+-------------------------------+------------------+
| Profile strength  ▓▓▓▓▓░░ 68% |                  |
| Business info (name search,   |  LIVE PREVIEW    |
|   category, address+map)      |  listing card:   |
| Contact (phone, email, site)  |  photo strip     |
| Hours                         |  name • category |
| Amenities                     |  ★ rating        |
| Photos (logo, cover, gallery) |  Open now · addr |
| About (bio, handle)           |  action row      |
+-------------------------------+------------------+
```

- **Name field stays place-search driven** (existing Google Places autocomplete); picking a place prefills address, coordinates, and — when available — phone, website, and category, each shown as an "auto-filled, tap to edit" value.
- **Profile strength meter** at the top with a checklist of what's missing ("Add hours", "Add 3 photos", …), each item scrolling to its section.
- **Live preview card** on the right (stacked below the form on mobile) rendering exactly the public listing header as you type.
- Behavior preserved: edit screen keeps autosave + `SaveStatus`; create screen keeps localStorage drafts and writes to the database only on submit.

## Public gym page

`/orgs/$orgId` redesigned as a listing:
- Photo strip hero (cover + gallery, tap to open a lightbox).
- Title block: name, verified check, category, rating + review count, price/level line.
- Action row: Call, Directions, Website, Share, Save — Directions opens Google Maps for the stored place.
- Info rows: address with map preview, expandable hours with today's line and open/closed pill, phone, website.
- Amenity chips, About, then the existing sections (members/trainers, posts, reviews) kept below.

## Technical notes

- Migration on `trainer_orgs`: add `phone text`, `email text`, `category text`, `amenities text[] not null default '{}'`, `photos text[] not null default '{}'`, `hours jsonb not null default '{}'`, `timezone text`. Existing RLS/grants unchanged; the create RPC and `updateTrainerOrg`/`createStandaloneOrg` server functions extended to accept and validate the new fields.
- Gallery images upload to the existing public `org-covers` bucket via `uploadDataUrlToBucket` (path prefix already scoped to the owner id).
- New shared modules: `src/lib/org-hours.ts` (hours type, validation, open-now resolution, formatting), `src/lib/org-listing.ts` (category/amenity catalogs, profile-strength scoring), `src/components/org/HoursEditor.tsx`, `PhotoGalleryEditor.tsx`, `ListingPreviewCard.tsx`, `ProfileStrengthMeter.tsx`.
- `OrgForm.tsx` is rebuilt into the listing editor and continues to be the single source used by both create and edit routes, so the two stay in sync.
- Unit tests for hours parsing/open-now (including overnight ranges and closed days) and profile-strength scoring.
