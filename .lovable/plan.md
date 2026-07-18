## Goal

Move Players and Teams page state (filters + view/density) into URL search params — matching the Feed pattern — so refresh, back/forward, and shared links all restore the exact view. Result counts and CTAs already derive from the filtered list; wiring them to the URL-driven state keeps them live automatically.

## Players page (`src/routes/_tabs.players.tsx`)

Add `validateSearch` (zod + `fallback`, per `tanstack-search-params`) with:

- `q: string`
- `sport: string`
- `skill: string` (one of SKILLS or "")
- `dist: number` (miles, 0 = off)
- `ageMin: number | ""`, `ageMax: number | ""`
- `unknownAge: boolean` (default true)
- `when: "any" | "today" | "week" | "weekend"`
- `view: "list" | "map"`
- `density: "grid" | "list"`

Replace the `useState` + `localStorage` block and the `loadStoredFilters` helper with `Route.useSearch()` reads and a single `updateSearch(partial)` helper built on `useNavigate({ from })` + `search: (prev) => ({ ...prev, ...partial })` (function form preserves other params). Every setter passed to filter chips, the search input, the filter sheet, and `ViewDensityToggle` becomes a call to `updateSearch`. Drop the `FILTERS_STORAGE_KEY` write effect and the `openrun:players-*` localStorage reads/writes.

The subtitle line ("… players"), the "N players available" section header, the empty state, and the filter-count badge already read from the filtered list / current filter values, so they stay live once the values come from search params.

## Teams page (`src/routes/_tabs.teams.tsx`)

Same pattern. Search schema:

- `q: string`
- `kind: "team" | "coach"`
- `sport: string`
- `avail: "any" | "recruiting" | "weekly" | "casual"`
- `sort: "nearest" | "followers" | "name"`
- `view: "list" | "map"`
- `density: "grid" | "list"`

Replace the local `useState`s and the two `openrun:teams-*` localStorage reads/writes with `Route.useSearch()` + `updateSearch`. The kind segmented control, sport chips, availability chips, sort select, search input, and `ViewDensityToggle` all call `updateSearch`. The location line + result count already derive from `list.length`, so they update in real time.

## Shared rules

- Use `fallback(schema, default).default(default)` for every field so a stray/malformed URL value silently reverts to the default (never throws) — no `.min/.max/.enum` on `validateSearch` per `tanstack-search-params`. Constrain enums in the component (`view === "map" ? ... : ...` already works this way).
- Function-form navigation only: `navigate({ search: (prev) => ({ ...prev, sport: s }) })`. Never object-form partial updates.
- No `loaderDeps` needed — this page has no loader that depends on search.
- One-time migration read: on mount, if the URL has no params and the old `openrun:players-*` / `openrun:teams-*` / `openrun.playersFilters.v1` keys exist, hydrate the URL from them once, then delete the keys. Keeps existing users' saved views on their first visit after the change.

## Out of scope

- Feed page (already URL-driven).
- No new filters, no visual redesign, no server-side changes.
- No `og:image` / metadata changes.

## Technical notes

- Imports: `zodValidator, fallback` from `@tanstack/zod-adapter`, `z` from `zod`, `useNavigate` (already imported on Players; add on Teams).
- `Route.useSearch()` return type is inferred — do not annotate.
- The current `useEffect` that persists filters to localStorage is deleted, not kept in parallel — URL is the single source of truth.
