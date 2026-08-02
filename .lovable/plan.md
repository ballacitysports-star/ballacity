# Multi-sport filters with per-sport skill levels

Today every filter surface lets you pick exactly one sport, and the skill level is a single value that only makes sense for that one sport. The Home feed is the one exception — it already accepts several sports in the URL (`sport=Basketball,Football`).

The change: sports become multi-select everywhere, and skill level is chosen **per selected sport**, exactly the way the Sports section of Edit profile works (Baseball → Minor AAA, Football → 7v7 Elite, Tennis → 3.5 NTRP). A player or post matches when it satisfies the level for **any** of the picked sports.

## What changes per screen

**Available Players** (`/available-players`)
- The quick sport strip and the Sport section in the Filters sheet toggle sports in and out instead of replacing the selection. "All sports" clears.
- The single "Skill level" chip row is replaced by one level block per selected sport, each using that sport's real scale (grouped chips for Football, multi-select where the profile allows it).
- Results match a post if it lists any selected sport, and — when a level is set for that sport — the author's level for it matches.
- Filter count and Reset account for the per-sport levels.

**Players tab** (`/players`)
- Same multi-select chips and per-sport level blocks in the filter sheet.
- URL keeps carrying the selection so back/forward and refresh stay in sync, and saved/persisted filters restore it.
- Levels that don't exist on a sport's scale (or a sport that gets deselected) are dropped automatically, as they are today.

**Teams and Trainers tabs**
- Sport chips become multi-select; a team/trainer matches if it covers any selected sport. Trainers' specialty list is derived from the selected sports (cleared when the sports change, as now). No skill level on these tabs.

**Home feed**
- Already multi-sport; it keeps working unchanged and now shares the same chip behavior and URL format as the rest.

## URL and persistence format

- `sport` stays a comma-separated list (`sport=Baseball,Football`) — the format the feed already uses, so existing single-sport links and bookmarks keep working.
- Skill becomes a per-sport map serialized into the existing `skill` param, e.g. `skill=Baseball:Minor AAA|Football:7v7 Elite`. A legacy flat value (`skill=Advanced`) is read as "applies to the first selected sport" so old links don't break.

## Technical notes

- New `src/lib/sport-filter.ts`: parse/serialize the sport list and the per-sport skill map, sanitize each entry through the existing `sanitizeSkillForSport`, and a `matchesSportSkillFilter(authorLevels, postSports, postSkill, map)` helper that ORs across sports on top of the current `levelMatchesFilter`.
- `src/components/SportChips.tsx` gains a multi-select mode (toggle a sport in/out, "All sports" clears) while keeping the current single-select callers working.
- New `src/components/filters/SportSkillLevels.tsx` renders the per-sport level blocks, reusing `scaleForSport` / `levelTiers` / `toggleSportTier` so the chips, groups, and hints read identically to `ProfileSportsFields`.
- `listOpenAvailabilities` takes `sports: string[]` and switches the Postgres filter from `contains("sports", [one])` to `overlaps("sports", list)`; the single-sport `sport` option stays as a thin alias.
- Teams/Trainers/Players list filters swap `o.sports.includes(sport)` for an any-of check; search-param schemas keep plain `z.string()` with `fallback`.
- Existing tests to keep green: `src/lib/sport-levels.test.ts`, `src/lib/trainer-feed-filter.test.ts`, and the `e2e/filterbar-persistence.spec.ts` / `e2e/trainers-venue-filter*.spec.ts` specs (the `sport=Basketball` URL assertions still hold).
