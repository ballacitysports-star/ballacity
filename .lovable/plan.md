Add a dedicated Teams tab to the bottom tab bar

Add a Teams tab to the mobile primary navigation so users can reach the /teams section directly.

## Plan

- Update `src/components/BottomNav.tsx`:
  - Import `Shield` from `lucide-react`.
  - Insert a new nav item between "Available Players" and "Create" that links to `/teams`.
  - Set its active match to `/teams` and any `/teams/*` sub-routes.
  - Keep the existing 5 tabs; the tab bar will flex to 6 items.
  - Use the same fill/stroke styling as the other non-gradient tabs.
- The layout wrapper in `src/routes/_tabs.tsx` already reserves bottom padding for the nav bar; no additional layout changes are needed because the flex container handles item distribution.
- Validate that the tab is active when viewing team detail pages (`/teams/$teamId`) and team index (`/teams`).
- Do not change the available-players tab behavior; it can still match teams if it already does.
