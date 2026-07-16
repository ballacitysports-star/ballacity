## Goal
Make the event cards on the profile page more compact so more of them are visible at once without scrolling.

## Scope
This targets the two card types rendered in the profile activity sections:
- `GameCard` — used in Hosting and Pickup sections.
- `RequestGameCard` — used in Pending Approvals section.

## Proposed Changes

### 1. Shrink card image height
Reduce the card hero image from `h-44` to `h-28` (or `h-32` if content feels cramped). This is the biggest single vertical win.

### 2. Tighten internal padding
Reduce card body padding from `p-4` to `p-3` and internal spacing from `space-y-3` to `space-y-2`.

### 3. Compact metadata rows
- Reduce text size on date/location lines from `text-sm` to `text-xs`.
- Shrink icon size from `h-4 w-4` to `h-3.5 w-3.5`.
- Reduce host/avatar row size and spacing.

### 4. Slim progress bar
Keep the progress bar but reduce height from `h-1.5` to `h-1`.

### 5. Compact request status box
For `RequestGameCard`, reduce the request status box padding from `p-3` to `p-2.5`, shrink timeline dot size, and make the action buttons smaller (`text-[10px]` / `px-2 py-0.5`).

### 6. Compact CTA bar
Reduce the bottom CTA/quick-join bar from `py-2.5` to `py-2` and font from `text-sm` to `text-xs`.

### 7. Preserve readability
- Keep the title at `text-lg` font-bold (or drop to `text-base` only if necessary).
- Keep sport/price badges at a readable size.
- Keep hover/tap affordances intact.

## Files to edit
- `src/components/GameCard.tsx`
- `src/components/RequestGameCard.tsx`

## Verification
- Open `/profile` on mobile and desktop widths.
- Confirm at least 2–3 cards are visible without scrolling on a typical phone viewport.
- Confirm cards remain readable and tappable.