## Goal

Badges/achievements today are hardcoded strings (e.g. "Reliable Player", "Top 5% Sportsmanship") stored in `ME.badges` in `src/lib/sample-data.ts` and in per-user overrides (`badges: string[]` in `src/lib/user-prefs-store.ts`). They're rendered as plain chips on the own-profile and public-player screens. Nothing derives them, and the only skill dependency left in this area is the "Skill Level" review criterion that feeds a player's top strengths. Replace all of that with a rules-based system driven by attendance reliability and sportsmanship.

## What to build

### 1. Badge definition module (`src/lib/badges.ts`)

A single canonical catalog, each badge with: `id`, `label`, `emoji`, `description` (plain-English criteria), `tier` (bronze/silver/gold), `category` (`reliability` | `sportsmanship` | `community`), and an `earned(stats)` predicate plus optional `progress(stats)` returning `{ current, target }`.

Input shape (already exists as `ReliabilityBreakdown` + sportsmanship in `sample-data.ts`, extended slightly):
- reliability: `showUpRate`, `onTimeRate`, `lastMinuteCancels` (30d), `currentStreak`, `longestStreak`, `gamesPlayed`, `hosted`
- sportsmanship: `rating`, `reviewCount`, trait counts (`respectful`, `communicative`, `fairPlay`, `positive`, `onTime`)

Proposed catalog:

Attendance reliability
- Showed Up — 5+ games attended
- Reliable Player — 15+ games, show-up rate ≥ 90%
- Ironclad — 30+ games, show-up rate ≥ 97%, 0 last-minute cancels in 30 days
- On Time, Every Time — 20+ games, on-time rate ≥ 95%
- Streak Keeper — current streak ≥ 5
- Streak Legend — longest streak ≥ 15
- No-Show Free — 60 days with zero last-minute cancels

Sportsmanship
- Good Sport — 5+ reviews, sportsmanship rating ≥ 4.5
- Respected — 10+ "respectful" mentions
- Great Communicator — 10+ "communicative" mentions
- Fair Play — 10+ "fair play" mentions
- Positive Presence — 10+ "positive" mentions
- Community MVP — 25+ reviews with rating ≥ 4.8

Community (kept, not skill-based)
- Verified, Host (5 / 25 games hosted)

No badge may reference a skill rating, tier, or `skill_levels`.

### 2. Remove the skill dependency from reviews

- Drop `{ key: "skill", label: "Skill Level" }` from the `player` criteria list in `src/lib/reviews.ts` and replace it with `{ key: "punctuality", label: "Punctuality" }` so the player set stays at 10 criteria and reinforces attendance.
- Strip `skill` from the seeded review `scores` objects and add `punctuality` values so top-strengths stay coherent.
- `src/routes/review.new.tsx` renders criteria from `CRITERIA`, so it updates automatically; verify no hardcoded "Skill Level" string remains.

### 3. Wire the engine into the UI

- `src/lib/sample-data.ts`: replace the literal `badges: string[]` array on `ME` with badge IDs computed from `ME.reliability` / `ME.sportsmanship` / `ME.stats` via the new engine (keeps the demo profile populated, now provably from criteria).
- `src/routes/_tabs.profile.tsx`: render earned badges as chips with emoji + label, and add an "In progress" row showing the next 3 unearned badges with their progress (e.g. "Ironclad · 24/30 games"). Tapping a badge shows its criteria text.
- `src/routes/players.$userId.tsx`: same earned-badge chips (no progress row for other people's profiles). Real profiles without reliability data resolve to zero stats and simply show no badges — same as today.
- `src/lib/user-prefs-store.ts`: keep `badges?: string[]` as a manual override/extra list, but treat engine output as the primary source and merge overrides on top.

### 4. Tests

Add `src/lib/badges.test.ts` covering: zero-stat profile earns nothing, threshold boundaries (exactly at vs. one below), progress values, and an assertion that no badge id/description mentions skill.

## Technical notes

- Pure client-side/derivation change; no database migration. `profiles.skill_levels` is already dropped.
- The reliability/sportsmanship numbers currently come from sample data for the demo profile; the engine takes a plain stats object so it can later be fed from real `game_participants` / `reviews` aggregates without changing the UI.
