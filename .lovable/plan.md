# Hosting stays tied to a team, trainer, or gym profile

Games are always hosted by an organization profile. A player-only account can't host until it adds a team, trainer, or gym profile. The current screen already blocks hosting, but its wording only mentions "team or club" and it doesn't reflect the new multi-profile model.

## What changes

- The gate on Host a game stays, but reads clearly: "Host as a team, trainer, or gym" with the explanation that games are published under an organization profile so players know who they're joining.
- The gate offers all three create paths: Create a team, Create a trainer profile, Create a club / gym.
- The gate only appears when the account truly owns no team, trainer, or gym profile. Owning any one of them (even if the active profile is the player profile) unlocks the form.
- "Host as" lists every team, trainer, and gym you own, labeled by type, and preselects your currently active profile when it is one of them (instead of only auto-selecting when there's exactly one).
- Publish button and helper text refer to "team, trainer, or gym profile" instead of "team or club".

## Technical section

In `src/routes/_tabs.create.tsx`:

- Keep the `affiliations.length === 0` early return; update its copy and add a third link to `/trainers/create`.
- Distinguish trainer from team in the empty-state and chips using the existing `kind === "coach"` mapping already present in `affiliationLabel`.
- Use `useMyProfiles()` from `src/lib/account-profiles.ts` to read the active profile, and in the auto-select effect prefer the affiliation whose id matches `active.refId` (when `active.kind` is team/trainer/gym); otherwise fall back to the single-affiliation auto-select already in place.
- Update the submit button label and the disabled-state hint strings.

No database or server-function changes: hosted games already carry `team_id` / `org_id` plus `host_id`.
