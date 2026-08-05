# Host a game without creating a team or club

Right now the Host a game screen blocks you with "Create a team or club first" unless you already own a team, trainer, or gym record — and even when you do, you must pick one before the form unlocks. This changes hosting so any profile can host directly.

## What changes

- The "Create a team or club first" blocking screen is removed. Anyone signed in can open the full Host a game form.
- "Host as" always includes your active profile at the top (your player profile, or the team / trainer / gym you're currently acting as), followed by any other teams, trainers, or gyms you own.
- Your active profile is preselected by default, so the form is usable immediately with no extra step.
- The publish button no longer says "Choose a team or club to continue"; it reads "Publish game" as soon as a host is selected (which is always the case).
- Games hosted as your player profile show you as the host; games hosted as a team/trainer/gym stay attributed to that profile exactly as today.
- Optional "Create a team" / "Create a club or gym" links stay available as a small hint under "Host as" instead of a blocking screen.

## Technical section

In `src/routes/_tabs.create.tsx`:

- Extend the `Affiliation` type with a `source: "self"` variant carrying the signed-in user's display name from `useMyProfile`, and read the active profile via `useMyProfiles`/active-profile helpers in `src/lib/account-profiles.ts` so the active team/trainer/gym is ordered first.
- Build `affiliations` as `[selfOrActiveProfile, ...myTeams, ...myOrgs]`, de-duplicating the active profile when it also appears in the team/org lists.
- Delete the `affiliations.length === 0` early-return block and initialize `selectedAffiliation` to the first entry once loading finishes.
- On submit, keep `teamId`/`orgId` undefined for the `self` source, and keep passing `hostUserId` + the resolved snapshot from `resolveHostSnapshot` so host attribution is the personal profile.
- Drop the disabled `fieldset` guard and the "Choose a team or club to continue" submit label; keep the required-selection styling only if the selection is ever cleared.

No database or server-function changes are needed: `hosted_games.team_id` and `org_id` are already nullable and `host_id` is the real owner.
