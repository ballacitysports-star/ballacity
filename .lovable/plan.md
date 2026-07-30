## Goal

When a player picks their sports, let them set a skill level for each one — using the language that sport actually uses (Baseball: AA / AAA / Major / National, Tennis: NTRP, Pickleball: DUPR, Running: pace, etc.) — save it to their account, and show it on their profile and public player page.

## Scales per sport

Each sport gets its own labelled scale. Proposed sets (easy to tweak later):

- **Baseball / Softball**: Rec, Little League, High School, Travel / Showcase, College, Minor A, Minor AA, Minor AAA, Major, National
- **Basketball**: Rec, High School, AAU / Travel, College, Semi-Pro, Pro
- **Football**: Flag Rec, Flag Competitive, High School, College, Semi-Pro
- **Soccer**: Rec, High School, Club / Travel, College, Semi-Pro, Pro
- **Tennis**: NTRP 1.5 → 7.0 (half-step increments)
- **Pickleball**: DUPR 2.0 → 6.0 (half-step increments)
- **Volleyball**: B, BB, A, AA, Open (plus Rec)
- **Running**: pace bands (e.g. 10:00+/mi, 9:00, 8:00, 7:00, sub-6:00) shown in the viewer's units
- **Fallback for anything without a curated scale**: Beginner, Intermediate, Advanced, Pro

Each entry records the scale name (e.g. "NTRP", "MiLB", "Self-rated") plus the chosen tier, so the profile can render "Tennis · 3.5 NTRP" or "Baseball · AAA".

## What the player sees

- **Sports editor** (shared by onboarding and Edit profile): under each selected sport, a "Level" row of chips using that sport's scale, plus the existing Positions chips. Optional — leaving it blank shows no level.
- **My profile**: each sport row shows its level next to the sport name, positions underneath.
- **Public player page**: same level badge, read from the saved account data.
- Real-time/draft save behaves exactly like the rest of those forms.

## Technical details

1. **Migration**: add `sport_levels jsonb not null default '{}'` to `public.profiles` (map of sport → `{ system, tier }`). No new table, so existing grants/RLS apply unchanged; owner-write + existing read policies already cover it.
2. **New `src/lib/sport-levels.ts`**: `LEVELS_BY_SPORT` (scale id, label, ordered tiers), the generic fallback, and helpers `levelsForSport()`, `formatSportLevel()`, plus parse/serialize for the jsonb map.
3. **`SportEntry`** in `src/components/profile/ProfileSportsFields.tsx` gains an optional `level?: { system: string; tier: string }`; the component renders the level chip row per sport.
4. **`src/lib/profile-payload.ts`**: `buildProfileRow` writes `sport_levels` from `input.sports`, so onboarding and Edit profile stay byte-identical (fingerprint/idempotency logic keeps working).
5. **`src/lib/user-prefs-store.ts`**: `ProfileOverrides.sports` / `MyProfile.sports` carry `level`; hydrate from `profiles.sport_levels` when loading the profile so it survives across devices.
6. **Display**: `src/routes/_tabs.profile.tsx` and `src/routes/players.$userId.tsx` render `formatSportLevel()` next to each sport.
7. No numeric 1–5 skill ratings return — these are named tiers on the sports list only; game difficulty stays untouched.

## Not included

- Filtering/search by sport level (can follow once the data exists).
- Verification of claimed levels.
