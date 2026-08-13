# Amateur-oriented skill levels

Today several ladders top out at professional tiers that almost no user on this app will pick (Baseball/Softball "Minor A/AA/AAA/Major/National", Basketball/Soccer "Semi-Pro/Pro", Volleyball "Open", Running "sub-6:00/mi"). The plan trims each ladder to the range real amateur players self-identify with, and keeps existing saved data valid by mapping retired tiers forward.

## New ladders

- Baseball / Softball (system label changes from "MiLB" to "Level"):
  `Casual / Pickup`, `Rec League`, `Little League / Youth`, `High School`, `Travel / Showcase`, `College / Adult Competitive`
- Basketball: `Casual / Pickup`, `Rec League`, `High School`, `AAU / Travel`, `College / Adult Competitive`
- Soccer: `Casual / Pickup`, `Rec League`, `High School`, `Club / Travel`, `College / Adult Competitive`
- Football (keeps Flag / 7v7 / Full contact grouping, multi-select): sub-levels become `Casual`, `Rec`, `Competitive`, `Travel / Showcase`
- Volleyball: `Casual / Pickup`, `Rec (B)`, `Intermediate (BB)`, `Advanced (A)`, `Competitive (AA)`
- Tennis (NTRP): `1.5` – `5.0` only
- Pickleball (DUPR): `2.0` – `5.0` only
- Running (Pace): `12:00+/mi`, `11:00/mi`, `10:00/mi`, `9:00/mi`, `8:00/mi`, `7:00/mi or faster`
- Generic fallback: `Beginner`, `Casual`, `Intermediate`, `Advanced` (drops "Pro")

## Keeping existing data working

Retired tiers are aliased to their closest surviving amateur tier, so old profiles, availability posts, saved filter presets, and shared URLs keep rendering and matching:

- Baseball/Softball: `Rec` -> `Rec League`; `Minor A/AA/AAA`, `Major`, `National`, `College` -> `College / Adult Competitive`
- Basketball/Soccer: `Rec` -> `Rec League`; `Semi-Pro`, `Pro`, `College` -> `College / Adult Competitive`
- Football: `Elite` sub-tier -> `Travel / Showcase`; current legacy aliases stay
- Volleyball: `B/BB/A/AA` -> new labelled equivalents; `Open` -> `Competitive (AA)`
- Tennis `5.5/6.0/7.0` -> `5.0`; Pickleball `5.5/6.0` -> `5.0`
- Running `6:00/mi` and `sub-6:00/mi` -> `7:00/mi or faster`
- Generic `Pro` -> `Advanced`

## Technical notes

- `src/lib/sport-levels.ts`: replace `BALL_TIERS`, `FOOTBALL_SUB_TIERS`, and the per-sport entries in `LEVELS_BY_SPORT`/`GENERIC_SCALE`; generalize `LEGACY_TIER_ALIASES` from a football-only map to a per-sport map (with a shared fallback map) consumed by `migrateTier`, which already runs inside `parseSportLevels`, `parseSkillTiers`, and `sanitizeSkillForSport` — so no call sites change.
- Update `src/lib/sport-levels.test.ts` and `src/lib/sport-filter.test.ts` fixtures that reference `Minor AAA` / `Semi-Pro`, plus doc comments in `src/lib/sport-filter.ts`, `src/lib/sample-data.ts`, and `src/routes/_tabs.players.tsx`.
- No database migration needed: stored `sport_levels` jsonb and post skill strings are free-text and normalized on read; the availability validation trigger does not hardcode tier lists.
- Run the vitest suite after the change to confirm filters and level parsing still pass.
