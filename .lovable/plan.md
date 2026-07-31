## Problem

The crop frame ratio is already fixed (1:1 for avatars, 16:9 for covers) and stays that way. What's actually distorting is the **image being cropped**, not the frame.

Both crop surfaces render the photo as an absolutely positioned `<img>` with explicit pixel `width`/`height` (natural size × zoom):

- `src/components/ImageEditorDialog.tsx` (lines ~383–399)
- `src/components/ImageCropperDialog.tsx` (lines ~257–272)

Tailwind's base stylesheet applies `img { max-width: 100%; height: auto }`. The inline `height` wins over `height: auto`, but the inline `width` does **not** override the stylesheet's `max-width: 100%`. So as soon as the zoomed image is wider than the crop container — which is the normal case for any portrait or high-res photo, and for every zoom-in — the width gets clamped to the container while the height stays at the full computed value. Result: the photo is squeezed horizontally, i.e. stretched vertically, and the aspect ratio visibly changes as you zoom.

## Fix

In both crop dialogs, on the crop-canvas `<img>` inline style:

- add `maxWidth: "none"` and `maxHeight: "none"` so the explicit pixel dimensions are honored exactly
- add `objectFit: "fill"` as a harmless no-op safeguard (dimensions already match the natural ratio, so nothing is resampled)

No changes to `aspect`, `cropW`/`cropH`, `minScale`, gesture math, or the export canvas — those are already ratio-correct, and the exported crop was never distorted (only the on-screen preview was), so output stays identical.

## Verification

Open the profile edit screen, upload a tall portrait photo into both the cover (16:9) and avatar (1:1) editors, and confirm with an element screenshot that the subject keeps its proportions at minimum zoom and while pinching/zooming in, and that the crop frame itself stays a fixed square/16:9 throughout.

## Files touched

- `src/components/ImageEditorDialog.tsx`
- `src/components/ImageCropperDialog.tsx`
