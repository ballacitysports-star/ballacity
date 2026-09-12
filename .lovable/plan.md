# Make Highlights and Notifications fill the screen like other pages

Both pages currently sit in a fixed narrow column, so on a laptop or tablet they look pinched with large empty space on either side, unlike the rest of the app.

## What changes

- **Highlights**: the header, sport filter row, and the reel list share the same width and grow with the window, capped at the app's standard content width (896px) instead of the current 470px phone column. On a phone nothing changes.
- **Notifications**: moves from the 512px form column to the same standard content width, so it matches the feed and other pages.
- Side spacing continues to scale smoothly with the window (no jumps at breakpoints), and the bottom nav still clears the content.

## Technical notes

1. `src/routes/_tabs.highlights.tsx`: replace the three `page-shell-feed` containers (header row, stories rail, `<main>`) with `page-shell-flush` (56rem, unpadded — the inner rows already supply `px-4`).
2. `src/routes/_tabs.notifications.tsx`: `page-shell-narrow` → `page-shell-content`.
3. No change to `src/styles.css` utilities, no logic or data changes.
