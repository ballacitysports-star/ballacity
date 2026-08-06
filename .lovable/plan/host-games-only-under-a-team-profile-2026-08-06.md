# Host games only under a team profile

Hosting becomes team-only. Whatever profile you're currently acting as — player, trainer, or gym — the create-game screen publishes under a team profile you own.

## What changes

- "Host as" lists only teams you own. Gym profiles no longer appear and can't publish games.
- If you own no team profile, Host a game shows a single path: "Create a team" (the "Create a club / gym" option is removed from that gate).
- If you're acting as a gym or trainer, the picker no longer preselects it; it preselects your active team when you have one, otherwise your only team.
- Copy across the flow says "team profile" instead of "team or gym": gate heading and body, picker hint, submit-button label, and the missing-selection toast.

## What is kept

Existing gym and trainer profiles stay in the switcher, viewable and editable, and games already hosted under a gym keep working. Nothing is deleted.

## Technical section

In `src/routes/_tabs.create.tsx` only:

- Drop `listMyOrgs` / `myOrgsQuery` / `myOrgs` from the affiliation list; `affiliations` becomes owned teams with `kind !== "coach"`.
- Narrow `Affiliation` to `source: "team"`; keep passing `teamId` and leave `orgId` undefined on publish.
- Simplify `affiliationLabel` to "Team".
- Update the empty-state gate (heading, body, single "Create a team" CTA), the "Pick the team…" hint, the submit label, and the required-selection toast text.

No database or server-function changes; `hosted_games.team_id` / `org_id` stay as they are.
