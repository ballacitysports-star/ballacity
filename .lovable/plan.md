## Goal

Give trainers a friendly "Recurring rules" editor (e.g. "Every Tue & Thu, 6–8 PM, at Riverside Park") that automatically populates the monthly calendar for up to 6 months, on top of the existing weekly slots and per-date overrides.

## Why a new layer (not just weekly slots)

The current model has two pieces:
- `availabilitySlots` — plain weekly pattern, one row per weekday+window, infinite.
- `availabilityOverrides` — per-date replacements/closures.

That covers "every week forever" but not: bi-weekly, first/third Tuesday, a rule that only applies for a date range, or grouping several weekdays/venues into one editable rule. Trainers also can't see at a glance which calendar days came from which recurring intent.

We add a third layer — `availabilityRules` — that expands into the same `ResolvedWindow` shape the calendar already renders. Existing weekly slots keep working unchanged.

## Data model

New column on `public.teams`:

- `availability_rules` (`jsonb`, default `'[]'`) — array of rules. Each rule:

```text
{
  id: string,
  label?: string,              // "Weekday evenings"
  weekdays: ("sun".."sat")[],  // one or more
  start: "HH:MM",
  end:   "HH:MM",
  venue?: string,              // must be in verified venues
  freq: "weekly" | "biweekly" | "monthly-nth",
  interval?: number,           // for weekly (1 = every week, 2 = every other)
  weekOfMonth?: (1|2|3|4|"last")[],  // when freq = "monthly-nth"
  anchorDate: "YYYY-MM-DD",    // start of recurrence (defines biweekly phase)
  until?: "YYYY-MM-DD"         // optional end, capped at 6 months from today
}
```

Precedence when resolving a date:
1. Per-date override (existing) — wins outright.
2. Recurring rules that match that date — expanded into windows.
3. Weekly slots (existing) — expanded for that weekday.

Rules and weekly slots merge (multi-window days are fine); duplicates are deduped by `(start,end,venue)`. Overrides still fully replace the day.

## UI

New "Recurring rules" section in the Availability step of `CreateOrgWizard` and in the trainer edit page, above the existing weekly + calendar editors:

- **Rule cards** — each rule shown as a compact card with label, weekday chips, time range, venue, cadence badge ("Weekly", "Every 2 weeks", "1st & 3rd of month"), effective date range, and menu (edit / duplicate / delete).
- **Add / edit rule sheet** — form with:
  - Multi-select weekday chips
  - Start / end time pickers (12h)
  - Venue picker (verified venues only, "Any" allowed)
  - Cadence radio: Weekly · Every other week · Specific weeks of month
  - "Repeats until" date (max = today + 6 months, defaults to horizon)
  - Live "next 3 occurrences" preview so the trainer sees dates before saving
- Validation reuses `validateSlots` for the time window and `validateVenueList` for venue selection.

On the monthly calendar (`AvailabilityCalendar` + `TrainerAvailabilityMonth`):
- Days that light up because of a rule get the same lime dot as weekly slots.
- The selected-day detail panel labels each window with its source badge: `Rule`, `Weekly`, or `Custom` (override).

## Resolver changes

`resolveDay` (in `src/lib/availability-resolve.ts`) gains an optional `rules` parameter. New `expandRule(rule, date)` helper returns the windows contributed by a single rule for a specific date (empty if the rule doesn't fire that day). The tz-aware path enumerates the same candidate trainer-local dates and calls `expandRule` alongside the existing weekly lookup.

The 6-month cap is enforced two ways: `until` is clamped when the rule is saved, and the calendar already limits navigation to `maxHorizonDate`, so anything beyond 6 months is invisible even if a rule lacks `until`.

## Wiring checklist

1. `supabase--migration` — add `availability_rules jsonb not null default '[]'` to `public.teams`.
2. `src/lib/availability-resolve.ts` — add `AvailabilityRule` type, `expandRule`, and thread `rules` through `resolveDay` / `hasAvailability`.
3. `src/lib/availability-slots.ts` — add `validateRules` (weekday non-empty, valid times, venue verified, `until` within horizon).
4. `src/lib/sample-data.ts` — add `availabilityRules?: AvailabilityRule[]` to `Org`.
5. `src/lib/teams.functions.ts` — extend Zod `TeamShape` with `availability_rules`.
6. `src/lib/org-store.ts` — map `availability_rules` in row → org and in patch → row.
7. `src/components/AvailabilityRulesEditor.tsx` — new component: list of rule cards + add/edit sheet + occurrence preview.
8. `src/components/AvailabilityCalendar.tsx` — accept `rules`, pass into `resolveDay`, show source badge on selected-day windows.
9. `src/components/TrainerAvailabilityMonth.tsx` — accept `rules`, pass into `resolveDay`.
10. `src/components/CreateOrgWizard.tsx` and `src/routes/teams.$teamId.edit.tsx` — `rules` state, integrate the new editor above weekly/calendar, save through to `updateOrg`/`addOrg`.
11. `src/routes/trainers.$trainerId.tsx` — pass `org.availabilityRules` into `TrainerAvailabilityMonth`.
12. `src/components/BookSessionSheet.tsx` — pass rules into `resolveDay` so suggested times include recurring windows.

## Out of scope (call out, don't build)

- iCal/RRULE export, ICS import.
- Rules by month/day-of-month (e.g. "every 15th") — only weekday-based cadences.
- Automatic notification when a rule creates a slot; existing calendar view is the surface.
