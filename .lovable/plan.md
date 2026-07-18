## Goal

Make the team/coach creation wizard adapt to the sport(s) selected, so the fields shown match how that sport actually operates instead of a one-size-fits-all form.

## Approach

Keep the existing 4-step wizard shell, but drive step 2 ("Details") and parts of step 1 from a per-sport config. When a user picks Basketball, they get basketball-shaped fields. When they pick Tennis or Running (individual sports), the roster/league/record UI gives way to what those actually need.

## Sport-specific config

Add a `SPORT_CONFIG` map in `src/lib/sample-data.ts` (or a new `src/lib/sport-config.ts`) keyed by `Sport`, with fields like:

- `format` options (e.g. Basketball: 5v5 / 4v4 / 3v3 / 1v1; Soccer: 11v11 / 7v7 / 5v5; Volleyball: 6s / 4s / doubles; Tennis: singles / doubles; Pickleball: singles / doubles / round robin; Running: pace group / distance)
- `surface`/`venue` options (indoor court, outdoor court, turf, grass, hard court, clay, track, trail, road)
- `season`/`cadence` (year-round, spring league, summer, fall, weekly pickup)
- `positionsAvailable` (reuse existing `POSITIONS_BY_SPORT`)
- `commonEquipment` chips (reversible jersey, cleats, shin guards, paddle, racquet, knee pads, GPS watch…)
- `individualSport: boolean` — hides team-record/league/staff blocks and swaps in individual-sport fields (coach preferred distances, PR, USATF cert prompt, NTRP/UTR band for tennis, DUPR band for pickleball)
- `ratingSystem` label (NTRP, DUPR, UTR, self-rated 1–5) so the "Skill range" step uses the right vocabulary and scale

## Wizard changes

1. **Step 1 (Identity)** — after Sports selection, if 1+ sport picked, show a **Format** chip row and **Venue/Surface** chip row driven by the union of the selected sports' configs. Skill-range labels swap to the primary sport's rating system (NTRP/DUPR/UTR/1–5).

2. **Step 2 (Details)** — replace the current fixed Team/Coach blocks with a sport-aware layout:
   - **Team sports (Basketball/Soccer/Football/Volleyball/Baseball/Softball):** keep League, Home venue, Record, Staff. Add **Positions needed** using the existing `PositionsPicker` component (already handles per-sport positions and counts).
   - **Individual/racket sports (Tennis/Pickleball/Running):** hide League/Record/Staff; instead show **Practice group size**, **Meeting cadence** (weekly / bi-weekly / on-demand), **Rating band** (NTRP 3.0–4.5, DUPR 3.5–5.0, pace 7:00–8:30 /mi), and for Running a **Typical distances** multi-chip (5K, 10K, half, marathon, trail, ultra).
   - **Coach kind:** in addition to credentials + rate, show sport-specific credential presets (USAV, USATF, USSF, PPR, PTR, USPTA) as one-tap chips, plus **Session types** chips (1:1, small group, clinic, video review, on-court, remote plan).
   - **Multi-sport orgs:** if more than one sport is selected, render one collapsible details block per sport so each has its own format/positions/rating band.

3. **Step 3 (Branding)** — unchanged, but the live preview surfaces the new fields (format, venue, rating band) as small chips on the OrgCard preview.

## Data model

Extend `Org` in `sample-data.ts` (all optional so existing seed data still validates):

- `format?: string` (or `formatBySport?: Record<Sport, string>`)
- `venue?: string[]` (surfaces)
- `cadence?: string`
- `positionsNeeded?: Record<Sport, Record<string, number>>`
- `ratingBand?: { system: "NTRP" | "DUPR" | "UTR" | "PACE" | "SELF"; min: string; max: string }`
- `distances?: string[]` (running)
- `sessionTypes?: string[]` (coach)

Mirror the new columns on `public.teams` via a migration (all nullable / JSONB where appropriate) and extend the Zod schema in `src/lib/teams.functions.ts` so create/update accept them. Update `teams.$teamId.tsx` and `OrgCard.tsx` to display the new chips when present; missing values fall back to today's UI.

## Validation

`canNext` on step 1 stays the same. On step 2, individual sports drop the current `bio.length > 10` gate to just `bio.length > 10` (unchanged) — no new required fields; every sport-specific input is optional so users can publish fast.

## Out of scope

- No changes to the teams directory filtering (search/sort/sport chips already work).
- No changes to auth, realtime, or the cover uploader.
- No changes to the coach booking / rate flow beyond the credential presets and session-type chips.

## Technical notes (skip if not technical)

- New file: `src/lib/sport-config.ts` exporting `SPORT_CONFIG: Record<Sport, SportConfig>` and helpers `mergedFormats(sports)`, `mergedVenues(sports)`, `ratingSystemFor(sport)`.
- Reuse `PositionsPicker` from `src/components/PositionsPicker.tsx` — already sport-aware.
- One Supabase migration adds nullable columns: `format text`, `venues text[]`, `cadence text`, `positions_needed jsonb`, `rating_system text`, `rating_min text`, `rating_max text`, `distances text[]`, `session_types text[]`. Include GRANTs for `authenticated` + `service_role`; RLS policies already cover the table by `owner_id`.
- Regenerate Supabase types after migration; then extend the Zod schema and the `Org` mapping in `org-store.ts`.
