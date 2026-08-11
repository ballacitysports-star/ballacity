# Fluid page width on the game page

Make the game detail page (and its edit modal) auto-fit whatever device it's on, instead of jumping between three fixed widths.

## What changes

- The page content currently locks to `max-w-md` on phones, `max-w-2xl` on tablets and `max-w-4xl` on desktop, so mid-size windows leave large empty gutters and small phones feel cramped by fixed padding.
- Replace that with one fluid container that grows smoothly with the viewport: full width minus safe side padding, capped so text lines never get uncomfortably long on very wide screens.
- Side padding scales with the screen (tighter on small phones, roomier on tablets/desktop) instead of a fixed 16px.
- The edit modal, roster sheet, and the small centered dialogs get the same fluid treatment so they fill narrow phones and stay comfortable on large screens.
- Respect safe areas (notch, home bar) and dynamic viewport height so nothing hides behind the bottom nav or browser chrome.

## Technical notes

1. Add a `page-shell` utility in `src/styles.css` using `@utility`: `margin-inline: auto; width: 100%; max-width: min(100% , 72rem); padding-inline: clamp(0.75rem, 4vw, 2rem);` — one fluid container, no breakpoint jumps.
2. In `src/routes/games.$gameId.index.tsx`, swap the four `mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4` containers (lines ~1039, 1081, 1094, 1953) for `page-shell`, keeping their existing margin/spacing and conditional classes.
3. Dialog/sheet widths: edit modal `sm:max-w-xl` → `w-[min(100%,40rem)]` with `max-h-[90dvh]`; roster `SheetContent` → `w-[min(100%,28rem)]`; the inner `max-w-md` blocks (lines ~2242, 2697) → `w-[min(100%,28rem)]`.
4. Keep `viewport-fit=cover` in `__root.tsx` as-is and continue using `dvh` units for scroll containers.

Scope is this page only; other tabs keep their current widths until you want the same pass applied there.
