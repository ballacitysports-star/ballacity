## Goal

Add the same List / Map / Grid / Compact toggle bar the Feed page uses to the Players and Teams pages, with each mode wired to functions that make sense for that page.

## Players page (`src/routes/_tabs.players.tsx`)

Today: only Grid vs List density toggle (localStorage `openrun:players-density`).

Add a two-row toggle matching Feed:
- Row 1 — view: **List** (default), **Map**.
  - List = current availability rows.
  - Map = new lightweight map view showing players' city pins using existing `PlayMapView` styling (points from availability rows with lat/lng where present; a simple "no location" empty state otherwise).
- Row 2 — density: **Grid**, **Compact** (only visible when view = List).
  - Grid = existing card grid (`grid-cols-2 sm:grid-cols-3`).
  - Compact = single-column condensed rows (name + sport chip + distance + CTA), reusing the existing player card data.

Persistence: `openrun:players-view` and reuse `openrun:players-density`. No URL params (keep parity with current page — Feed's URL params can be a follow-up).

## Teams page (`src/routes/_tabs.teams.tsx`)

Today: single vertical list of `OrgCard`s, no toggle.

Add the same two-row toggle:
- Row 1 — view: **List** (default), **Map**.
  - List = current `OrgCard` stack.
  - Map = pins for each team/coach placed by their `city` (deterministic pseudo-coords like the existing `pseudoDistance` helper so the map is stable without geocoding). Tap a pin -> team detail.
- Row 2 — density: **Grid**, **Compact** (only when view = List).
  - Grid = 2-col responsive grid of the existing `OrgCard` (already looks fine at reduced width).
  - Compact = one-line rows (avatar, name, handle · city, sport chips, distance, chevron) — new lightweight `OrgListRow` component.

Persistence: `openrun:teams-view`, `openrun:teams-density`. Kind (Team/Coach) and sport filters keep working the same across all views.

## Shared piece

Extract the toggle bar markup used by Feed into `src/components/ViewDensityToggle.tsx` so Feed, Players, and Teams render the same control. Feed switches to it without behavior change. Each page passes its own `view`, `density`, setters, and available options (Players/Teams hide "Map" if we decide to ship map later — v1 ships all four).

## Out of scope

- No new server functions, DB fields, or geocoding. Map coordinates on Teams use deterministic pseudo-coords; Players Map uses whatever lat/lng already exists on availability rows.
- No changes to Feed logic, just the extraction to the shared component.
