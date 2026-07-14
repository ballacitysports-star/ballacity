## Problem

On the Pickup/Feed page, tapping the sliders (filter) button appears to do nothing.

The button's `onClick` correctly flips `filtersOpen` to `true`, and `<FilterSheet>` does render — but it renders invisibly off-screen.

### Root cause

The Feed's outer container applies an inline `transform: translateY(...)` for the pull-to-refresh indicator (in `src/routes/_tabs.feed.tsx`, around line 240):

```tsx
<div className="relative mx-auto w-full max-w-md ..." style={{ transform: `translateY(${indicatorOffset}px)`, ... }}>
```

Per CSS spec, any ancestor with a `transform` becomes the containing block for `position: fixed` descendants. `FilterSheet` uses `fixed inset-0 z-50 ... flex items-end` — so instead of covering the viewport, it covers only the (very tall) Feed container and anchors its bottom sheet to the bottom of that container, which sits far below the visible viewport. Nothing visible changes on tap.

## Fix

Render `FilterSheet` outside the transformed container using a React portal, so its `fixed` positioning resolves against the viewport again.

### Changes in `src/routes/_tabs.feed.tsx`

1. Import `createPortal` from `react-dom`.
2. Wrap the existing `<AnimatePresence>{filtersOpen && <FilterSheet ... />}</AnimatePresence>` block in `createPortal(..., document.body)`, guarded by a `typeof document !== "undefined"` check so SSR doesn't crash.
3. Leave the button, state, and `FilterSheet` component itself unchanged.

### Verification

- Manually tap the filter button on `/feed` (and via `/pickup` redirect) at mobile viewport — sheet slides up from the bottom of the viewport and the backdrop covers the full screen.
- Reset / Done / backdrop-tap close the sheet.
- Pull-to-refresh still works (unrelated container transform is untouched).
- No regressions to sport chips or search suggestions dropdown.

## Out of scope

No changes to filter logic, styling of the sheet, or the pull-to-refresh behavior.
