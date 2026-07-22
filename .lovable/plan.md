## Goal
Prevent game creation until the host has explicitly picked a team or club when they own more than one. Today the picker exists but nothing is pre-selected in the multi-team case, and the block only fires as a toast after the user taps Publish.

## Behavior changes (in `src/routes/_tabs.create.tsx`)

1. **Make "Host as" a required, visually obvious first step**
   - Add a small red "Required" chip next to the "Host as" section title while `selectedTeamId` is null and `myTeams.length > 1`.
   - Add helper copy under the pill row: "Pick who you're hosting as to continue."
   - When invalid, outline the section container in `border-destructive/60` so it reads as a required field, not decoration.

2. **Disable the rest of the form until a team is picked**
   - Wrap every section below "Host as" (Sport, Cover, Title, When, Location, Skill, Size, Price, toggles, Description, Publish) in a `<fieldset disabled={!selectedTeamId}>` with `aria-disabled` and a `pointer-events-none opacity-50` visual when disabled.
   - This makes the requirement obvious instead of surfacing as a post-submit toast.

3. **Keep and harden the submit guard**
   - Keep the existing `if (!selectedTeamId)` guard in the submit handler as a safety net.
   - On failed guard, additionally scroll the "Host as" section into view and focus the first pill so keyboard users land on it.

4. **Publish button reflects state**
   - Add `disabled={!selectedTeamId || publishing}` to the Publish button and swap its label to "Choose a team to continue" when `!selectedTeamId`, otherwise keep the current label.

5. **Single-team and zero-team paths unchanged**
   - Zero teams: existing empty state with "Create a team / Create a club" CTAs stays.
   - One team: auto-selected chip stays; form remains enabled.

## Out of scope
- No changes to `addHostedGame`, `listMyTeams`, migrations, or any other route.
- No new "team members can host" permissions — still owner-only.
- No visual redesign of the pill picker beyond the required-state affordances above.