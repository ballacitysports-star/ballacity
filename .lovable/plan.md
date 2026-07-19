## Goal
Let trainers set weekly availability windows during profile creation, so bookers can see when they're free.

## Data
Add a new JSONB column `availability_slots` on `public.teams` (nullable, default `'[]'`). Each entry: `{ day: "mon"|"tue"|...|"sun", start: "HH:MM", end: "HH:MM" }` (24h). Coach-only in practice; teams ignore it.

- Migration: `ALTER TABLE public.teams ADD COLUMN availability_slots jsonb NOT NULL DEFAULT '[]'::jsonb;`
- Update `teams.functions.ts` Zod schema (`availability_slots: z.array(z.object({ day, start, end })).default([])`).
- Update `org-store.ts` `Org` type (`availabilitySlots?: Slot[]`), row→Org mapping, Org→row mapping (coach only), and patch mapping.

## Wizard UI (`src/components/CreateOrgWizard.tsx`, coach branch only)
Add a new "Availability" section inside the existing rate/session-types step (near `Hourly rate` / `Session types` around line 725–790):
- Local state `slots: Slot[]`.
- Row editor: day dropdown (Mon–Sun), start time input, end time input, remove button.
- "Add time" button appends a default row (`{ day: "mon", start: "17:00", end: "19:00" }`).
- Validate `end > start`; skip invalid rows on submit.
- Include `availabilitySlots: isCoach ? slots : undefined` in the create payload (line ~167 area).

Optional empty state hint: "Add the windows you're usually free — bookers see these on your profile."

## Trainer profile (`src/routes/trainers.$trainerId.tsx`)
Where the schedule empty state renders (line ~423), if `org.availabilitySlots?.length`, render a compact list grouped by day (e.g., "Mon 5:00–7:00 PM"). No behavior change beyond display.

## Out of scope
- Editing availability post-creation (existing edit flow untouched).
- Booking calendar integration / conflict checks.
- One-off (non-recurring) availability dates.
- Timezone handling — stored as local wall time, matches how `cadence` is treated today.
