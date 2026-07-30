## Goal

Make photo cropping feel like Facebook's mobile photo cropper: a full-screen, thumb-driven surface where the photo is dragged and pinched directly, controls are big and out of the way, and advanced options are hidden until asked for.

## What changes for the user

**On phones (the primary fix)**
- Full-screen editor that respects the notch/home bar, so Cancel and Done are always reachable and nothing is cut off.
- Big, obvious top bar: "Cancel" on the left, title centered, a filled "Done" pill on the right — all at least 44px tall.
- The photo fills the screen; you reposition it by dragging and zoom by pinching, exactly as today, plus:
  - Double-tap to zoom in/out around the tap point.
  - Gentle rubber-band when you drag past the edge, snapping back on release (FB feel) instead of a hard stop.
  - A "Drag to reposition" hint that fades in on open and disappears on first touch.
- Crop overlay upgraded to FB style: dimmed surround, thin white frame, rule-of-thirds grid that appears only while you're actively dragging/pinching, and corner ticks.
- The zoom slider is removed from the mobile default view (pinch/double-tap replaces it) and replaced by a compact bottom action row: Fit, Rotate, Reset.
- Size and Quality pickers move off the main screen into an "Options" sheet (tap the sliders icon), so the mobile view isn't three stacked rows of tiny pills.
- Tool tabs (Crop / Transform / Adjust / Filter / Background) become a scrollable, icon-over-label row with larger tap targets, and the active tool's controls sit directly above them.
- Body scroll is locked while the editor is open, and browser pull-to-refresh/overscroll can't fire mid-drag.

**On desktop**
- Layout stays essentially as it is today: zoom slider, Fit/Reset, and inline Size/Quality rows remain visible. Only spacing and hit areas get a light pass so the two modes share one component.

## Technical notes

- Files: `src/components/ImageEditorDialog.tsx` (main work), `src/components/ImageCropperDialog.tsx` (same treatment so the legacy cropper doesn't drift), plus a small shared gesture hook.
- Extract the pointer/pinch logic that is currently duplicated in both dialogs into `src/hooks/use-crop-gestures.ts`: pointer map, pan/pinch anchoring (keep the existing focal-point math), new rubber-band clamp with spring-back, double-tap detection, and an `interacting` flag used to show/hide the thirds grid.
- Use the existing `useIsMobile()` hook (`src/hooks/use-mobile.tsx`) to branch layout only. Crop math, export/`confirm()` canvas path, filters, transform, and background removal are untouched, so output files are byte-for-byte equivalent for the same crop.
- Safe areas via `env(safe-area-inset-*)` padding on the top/bottom bars; container gets `h-[100dvh]` and `overscroll-none`.
- Options sheet uses the existing shadcn `Drawer`/`Sheet` primitive already in the project rather than a new dependency.
- Colors stay on existing tokens (`bg-lime-gradient`, `text-primary-foreground`, white/10 overlays) — no hardcoded hex.
- Verification: typecheck, then a Playwright pass at a 390x844 mobile viewport driving open → drag → pinch → double-tap → Done on the profile avatar and cover uploaders, with element screenshots of the crop surface at each step.

## Out of scope

No change to upload/storage behavior, no new crop aspect ratios, no free-form crop handles (FB doesn't offer them for avatar/cover either).
