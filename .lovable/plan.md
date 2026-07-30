## Goal

Make skill level on the Players tab read exactly like it does on a profile — per-sport tiers (Minor AAA, 3.5 NTRP, AAU / Travel) instead of generic Beginner / Intermediate / Advanced — across display, filtering, and posting availability. Profile levels win over the level stored on an old post.

## What changes

**1. Player levels come along with availability**
- Extend the availability fetch so each row also carries the author's `sport_levels` from their profile (same query that already pulls name/avatar/age — just add the column).
- Add a small helper that, given a post and a sport, resolves the level to show: profile tier for that sport first, then the post's own generic level as fallback.

**2. Player cards (Players tab list)**
- Replace the single lime "Intermediate" pill with per-sport level badges rendered the same way as the profile page (`formatSportLevel`), one per sport chip that has a level.
- Sports without a level on the profile keep just the sport chip — no fake level.

**3. Nearby players panel**
- Same resolution helper, so the card subtitle shows the profile tier for the matched sport instead of the generic label.

**4. Skill filter**
- The skill chips become sport-aware: when a sport is selected, chips list that sport's real tiers (from `LEVELS_BY_SPORT`); with no sport selected, show the generic tiers so the filter still works across sports.
- Matching uses the resolved level (profile-first), so filtering by "Minor AAA" finds players whose profile says so even if their post says "Advanced".
- Changing the sport clears an incompatible skill selection so the URL state never holds a tier that doesn't exist for the sport.

**5. Post availability dialog**
- Skill picker becomes per-sport: for each sport selected in the dialog, show that sport's tier chips, prefilled from the poster's own profile levels.
- Saved back into the existing `skill_level` text column as the primary sport's tier, so nothing about the table changes.

## Technical notes

- No database migration. `profiles.sport_levels` already exists and `player_availabilities.skill_level` stays a text column.
- Shared wording continues to come from `src/lib/sport-levels.ts` (`scaleForSport`, `levelsForSport`, `formatSportLevel`) — no duplicated tier lists.
- Files touched: `src/lib/availability.ts`, `src/lib/sport-levels.ts` (add resolver), `src/routes/_tabs.players.tsx`, `src/components/NearbyPlayersPanel.tsx`.
- Existing posts with legacy values ("All Levels", "Beginner") keep rendering fine through the fallback path.
