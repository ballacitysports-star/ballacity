## Goal

Make profile-type wording consistent everywhere. Today the app mixes "Team", "Club", "Trainer", "Coach", "Gym", "Facility", "Organization" without rules — the account picker uses combined labels ("Team / Club"), while other screens say "Coach", "Organization", or "Club" independently. Users see different words for the same thing depending on where they are.

## Canonical vocabulary

Adopt one label per account type and use it everywhere the type is named to a user:

| Type    | Noun (singular) | Plural  | Verb / role phrasing              |
| ------- | --------------- | ------- | --------------------------------- |
| player  | Player          | Players | "Play", "Join a game"             |
| team    | Team            | Teams   | "Host as team", "Team roster"     |
| trainer | Trainer         | Trainers| "Book a trainer", "Trainer profile"|
| gym     | Gym             | Gyms    | "Manage gym", "Gym members"       |

Rules:
- Drop the slash pairs ("Team / Club", "Trainer / Coach", "Gym / Facility"). The account picker becomes single-word labels with a one-line blurb underneath.
- "Club" → "Team" everywhere user-facing.
- "Coach" → "Trainer" everywhere user-facing (except where "Head Coach" is a job title inside a team roster — that's a role, not a profile type, keep it).
- "Facility" → "Gym" in profile-type contexts. In review-category labels like "Facility Quality" (which describes the venue, not the profile) keep as-is.
- "Organization" stays only for the technical trainer-org grouping feature (multi-trainer gyms). Its user-facing label becomes "Gym" wherever it names the account type, and stays "Organization" only in the internal org-membership UI where trainers join a gym.

## Scope of edits (user-facing strings only)

1. `src/lib/account-type.ts` — update `ACCOUNT_TYPE_META` labels and blurbs to the canonical vocabulary; add optional `plural` and `verb` fields so callers can render consistent copy from one source.
2. `src/routes/onboarding.account-type.tsx`, `src/components/AccountTypePicker.tsx`, `src/components/AccountTypeGate.tsx` — read from the updated meta; no bespoke labels.
3. Team-side surfaces (`src/routes/teams.*`, `TeamCoverUploader`, `CreatePostSheet` team copy, `_tabs.teams.tsx`, filter labels) — replace "Club" with "Team".
4. Trainer-side surfaces (`src/routes/trainers.*`, `create/CreateTrainerWizard.tsx`, `TrainerActions`, `TrainerProfileChecklist`, `TrainerOrgSection`, review-flow labels for trainers) — replace user-facing "Coach" with "Trainer"; keep "Head Coach" only where it's a roster job title.
5. Gym-side surfaces (`src/routes/orgs.*`, `OrgForm`, `OrgCard`, `CreateOrgWizard`, settings "My organizations") — where the label names the account type, use "Gym"; keep "Organization" only in the trainer→gym membership UI copy where it refers to the linkage feature, not the profile type.
6. Feed/discover copy (`_tabs.feed.tsx`, `_tabs.discover.tsx`, filter chips, empty states) — normalize headings like "From teams & clubs" → "From teams", "Coaches" → "Trainers", "Facilities" → "Gyms".
7. Host-selection UI (`_tabs.create.tsx` "Host as", `EditGameModal` host picker) — use "Team" and "Gym"/"Trainer" verbatim.
8. Settings and profile chips already using `ACCOUNT_TYPE_META.label` inherit the new wording automatically.

## Out of scope

- Database column names, enum values (`team`, `trainer`, `gym`, `player` stay).
- Route paths (`/teams`, `/trainers`, `/orgs`) stay — no navigation breakage.
- Review category labels that describe the venue itself ("Facility Quality") not the profile type.
- Job-title role strings inside team rosters ("Head Coach", "Player-Coach").
- Any layout, color, or component-shape changes.

## Verification

- Grep for the retired phrases ("/ Club", "/ Coach", "/ Facility", user-facing "Club", user-facing "Coach", "Facilities") and confirm remaining hits fall into an allow-list (role titles, review categories, technical org linkage).
- Manual pass over: account picker, onboarding, `/settings`, `/profile`, `/teams`, `/trainers`, `/orgs`, feed filter chips, create-game "Host as", edit-game host picker.

## Files touched

`src/lib/account-type.ts` plus targeted string replacements in the components and routes listed above. No new files, no schema, no route changes.
