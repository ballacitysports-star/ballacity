# Parent-to-Team-Leader Messaging

## Goal
Let a parent contact their linked child’s team leadership directly from that team’s page, without exposing athlete-only controls or weakening messaging safeguards.

## User experience
- Show a **Message team** action on a team page only when Parent Mode is active and at least one linked child belongs to that team.
- Include all team leaders: **owner, manager, and coach**.
- If there is one leader, open or create that conversation immediately.
- If there are multiple leaders, show a compact picker with each leader’s name, avatar, and role, then open the selected conversation.
- Show clear loading, unavailable, and error states; do not show the parent’s own account as a recipient.
- Keep the existing Messages inbox and message-request acceptance experience unchanged.

## Safety and access
- Resolve eligible contacts through an authenticated server function that first verifies the signed-in adult has an active guardian/managed-child relationship and that the linked child is on the requested team.
- Return only the minimum display details for team members whose role is owner, manager, or coach.
- Reuse the existing direct-conversation function, which already enforces blocks, recipient privacy preferences, message requests, and minor-messaging restrictions.
- Do not add a new conversation system, broaden roster visibility, or change permissions for players, children, or team staff.

## Implementation
- Add a focused guardian team-contact function and query hook.
- Add the Parent Mode **Message team** action and leader picker to the existing team page action area.
- Reuse the existing conversation creation helper and navigate to the resulting thread.
- Add focused tests for eligibility filtering, leader roles, self-exclusion, single-recipient behavior, and multiple-recipient selection.

## Verification
- Run the focused tests and typecheck/build checks.
- Verify in the browser that a parent sees the action on a linked child’s team, can select a leader, and reaches the correct message thread.
- Verify the action is absent on unrelated teams, in managed-child sessions, and while using an explicit team/trainer/gym profile.
