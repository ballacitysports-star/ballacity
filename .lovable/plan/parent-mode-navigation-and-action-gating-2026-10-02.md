# Parent-mode navigation and action gating

## Goal
Make the signed-in guardian account feel like a true Parent Mode while preserving the existing separate child, player, team, trainer, and gym profiles.

## Changes
- Detect Parent Mode only when the account is recognized as a guardian and its active profile is the guardian's placeholder personal profile.
- Replace the athlete-oriented bottom navigation in Parent Mode with parent destinations, including Guardian Dashboard and Parent Center, with correct active highlighting.
- Keep discovery and activity reachable for parents, but remove athlete-only destinations such as the player's own highlight/profile experience.
- Disable tab-swipe routing through athlete-only tabs while Parent Mode is active so gestures and visible navigation remain consistent.
- Hide or replace athlete-only calls to action in shared screens, including creating highlight reels, posting player availability, and joining games or rosters as the guardian identity.
- Preserve normal athlete actions after the guardian explicitly switches into a managed child or a separate adult player/team/trainer/gym profile.

## Verification
- Check Parent Center and Guardian Dashboard highlighting on mobile navigation.
- Confirm parent browsing still works and athlete-only prompts do not appear.
- Confirm non-parent and switched-profile navigation remains unchanged.
- Run focused tests and inspect the preview for build/runtime errors.

## Technical details
- Reuse the existing guardian-identification hook and active-profile state rather than introducing a second role system.
- Keep all changes in presentation/navigation logic; do not change database policies, family permissions, or payment behavior.
- Add focused tests for the parent-mode navigation decision and action visibility where practical.
