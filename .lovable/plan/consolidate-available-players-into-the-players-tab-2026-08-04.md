# Consolidate Available Players into the Players tab

Everything lives on one screen: `/players`. The old `/available-players` page is deleted outright — no redirect — after its unique features move over.

## What moves to /players

1. **Shared post links** — `/players?post=<id>` opens that availability in a focused view (fetch by id, show it even if filters would hide it, clear the param when dismissed). Notification links now point at `/players?post=…` instead of the old path.
2. **Player card with key stats** — the sport hero links to `/players/$userId` with a "View profile" overlay, a stats strip (skill level, sports count, city, travel radius) and a full-width "View full profile" button.
3. **My posts + requests** — a "Mine" view alongside "Browse": your own availability posts with edit and delete, plus incoming and outgoing contact requests (the existing request panel).
4. **Share** — copy-link action on an availability, including inside the focused post view.

Existing Players behaviour is preserved: multi-sport + per-sport skill filters, distance/age/when filters, map and grid/list toggles, saved view settings, post-availability sheet, contact dialog.

## What gets removed

- `src/routes/available-players.tsx` (and its route entry). Old `/available-players` URLs will hit the 404 page.
- The duplicate bottom-nav target: the Players tab keeps its single `/players` destination and active-state check.

## Technical notes

- `_tabs.players.tsx` search schema gains `post: fallback(z.string().optional(), undefined)` and `tab: fallback(z.string(), "browse")`. `post`/`tab` are excluded from the persisted-search snapshot so a shared link or a visit to Mine doesn't become the remembered default.
- Reuse the availability helpers already imported by both pages (`getAvailabilityById`, `listMyAvailabilities`, `listMyContactRequests`, `updateAvailability`, `setContactRequestStatus`) rather than re-implementing them.
- Extract the ported pieces into components under `src/components/players/` (focused post view, Mine view, share action) so `_tabs.players.tsx` doesn't balloon; keep card presentation in the existing `AvailabilityCard`.
- `src/lib/availability.ts` notification link becomes `/players?post=${availabilityId}`.
- E2E specs referencing `/available-players` (`oauth-no-signin-flash-on-navigation`, `oauth-non-root-referrer`) switch to `/players`.
- Verify with `tsgo` plus a browser pass over `/players`, `/players?post=<id>`, and the Mine view.
