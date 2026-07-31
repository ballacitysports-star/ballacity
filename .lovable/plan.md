# Add 7v7 to Football skill levels

Football currently offers one flat list of levels: Flag Rec, Flag Competitive, High School, College, Semi-Pro. There is no 7v7 option. This adds 7v7 as its own labelled group with its own skill tiers, so a player can say "7v7 — Competitive" instead of squeezing it into flag or tackle levels.

## What changes for the user

In the Sports section (Edit profile and onboarding), Football's level chips get grouped headings:

```text
Level                       Level
FLAG            ->          7v7
[Rec] [Competitive]         [Rec] [Competitive] [Showcase / Travel] [Elite]
                            TACKLE
                            [High School] [College] [Semi-Pro]
```

- Only one level is selectable at a time, exactly as today.
- Selected 7v7 levels read as "7v7 Competitive" wherever skill level appears — profile header, Players tab, Nearby players, availability posts — because those all format from the same stored tier.
- Existing football levels (Flag Rec, High School, etc.) are unchanged and stay selected for anyone who already picked them.

## Skill tiers under 7v7

7v7 Rec, 7v7 Competitive, 7v7 Showcase / Travel, 7v7 Elite

Tier labels carry the "7v7" prefix so the value is self-describing everywhere it is displayed, and no display or filter code needs to know about groups.

## Technical notes

- `src/lib/sport-levels.ts`: extend `SportScale` with an optional `groups?: { label: string; tiers: string[] }[]`. Football gets groups Flag / 7v7 / Tackle; `tiers` stays the full flat ordered list (existing flag/tackle tiers plus the four new 7v7 tiers) so `levelsForSport`, `filterTiersForSport`, `sanitizeSkillForSport`, and the skill filter URL sync keep working untouched.
- `src/components/profile/ProfileSportsFields.tsx`: when a scale has `groups`, render chips per group with a small uppercase group heading; otherwise render the current flat chip row.
- No database change: `profiles.sport_levels` already stores `{ system, tier }` per sport.
- Add cases to `src/lib/sport-levels.test.ts` covering that Football's flat tiers include the 7v7 tiers, that group tiers are a partition of the flat list, and that `sanitizeSkillForSport("Football", "7v7 Elite")` is kept while a tier from another sport is dropped.
