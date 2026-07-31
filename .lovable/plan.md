# Add 7v7 and Full contact to Football skill levels

Football currently offers one flat list of levels: Flag Rec, Flag Competitive, High School, College, Semi-Pro — flag has its own tiers while tackle levels are school/league names. This restructures Football into three formats (Flag, 7v7, Full contact), each using the same sub-level ladder, and removes the redundant one-off tackle tiers.

## What changes for the user

In the Sports section (Edit profile and onboarding), Football's level chips get grouped headings:

```text
Level                     Level
FLAG            ->        FLAG
[Rec]                     [Rec] [Competitive] [Showcase / Travel] [Elite]
[Competitive]             7V7
TACKLE                    [Rec] [Competitive] [Showcase / Travel] [Elite]
[High School]             FULL CONTACT
[College]                 [Rec] [Competitive] [Showcase / Travel] [Elite]
[Semi-Pro]
```

- Only one level is selectable at a time, exactly as today.
- A selection reads as "7v7 Competitive" or "Full contact Elite" wherever skill level appears — profile header, Players tab, Nearby players, availability posts — since those all format from the same stored tier.
- Same ladder for all three formats: Rec, Competitive, Showcase / Travel, Elite. No format-specific one-off tiers.

## Removing redundancy

- `High School`, `College`, and `Semi-Pro` are dropped as Football tiers; they are covered by Competitive / Showcase / Travel / Elite under Full contact.
- `Flag Rec` and `Flag Competitive` are renamed to the shared pattern (`Flag Rec`, `Flag Competitive` stay valid labels under the Flag group; the extra two tiers are added).
- Anyone whose profile holds a removed tier gets it mapped forward on read: High School -> Full contact Competitive, College -> Full contact Showcase / Travel, Semi-Pro -> Full contact Elite. Nothing needs re-picking, and no stale tier can stick in a filter URL.

## Full tier list for Football

Flag Rec, Flag Competitive, Flag Showcase / Travel, Flag Elite, 7v7 Rec, 7v7 Competitive, 7v7 Showcase / Travel, 7v7 Elite, Full contact Rec, Full contact Competitive, Full contact Showcase / Travel, Full contact Elite

Tier labels carry the format prefix so the value is self-describing everywhere it is displayed, and no display or filter code needs to know about groups.

## Technical notes

- `src/lib/sport-levels.ts`: extend `SportScale` with an optional `groups?: { label: string; tiers: string[] }[]`. Football gets groups Flag / 7v7 / Full contact; `tiers` remains the full flat ordered list (the union of the groups) so `levelsForSport`, `filterTiersForSport`, `sanitizeSkillForSport`, and the skill filter URL sync keep working untouched.
- Add a small legacy-tier alias map in `sport-levels.ts` applied inside `parseSportLevels` / `resolvePlayerLevel` so retired Football tiers resolve to their new equivalents on read.
- `src/components/profile/ProfileSportsFields.tsx`: when a scale has `groups`, render chips per group under a small uppercase group heading; otherwise render the current flat chip row.
- No database change: `profiles.sport_levels` already stores `{ system, tier }` per sport.
- Add cases to `src/lib/sport-levels.test.ts`: group tiers are exactly a partition of the flat list, `sanitizeSkillForSport("Football", "Full contact Elite")` is kept, a tier from another sport is dropped, and legacy `High School` resolves to `Full contact Competitive`.
