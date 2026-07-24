## Replace Search tab with Available Players

In `src/components/BottomNav.tsx`, swap the 2nd bottom-nav tab (currently Search → `/discover`) for an "Available Players" tab that links to the existing `/available-players` route.

### Changes
- Replace the `Search` icon import with `Users` from `lucide-react`.
- Update the 2nd nav item:
  - `to: "/available-players"`
  - `label: "Available Players"`
  - `icon: Users`
  - `match: (p) => p.startsWith("/available-players") || p.startsWith("/discover") || p.startsWith("/players") || p.startsWith("/teams") || p.startsWith("/trainers")`
- Remove the `it.label !== "Search"` special-case in the fill logic (no longer needed).

No other files change; `/available-players` route already exists.