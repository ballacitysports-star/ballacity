## What's happening

The full-screen crop/edit screen is rendered *inside* the form field it belongs to, and that field is built as a `<label>` element (`Field` in `src/components/profile/ProfileFormPrimitives.tsx:26-32`) that also contains the hidden `<input type="file">` (`src/components/ImageUploader.tsx:147-157`). Clicking anywhere inside a label activates its file input — so every tap on the crop surface, the drag area, or the bottom controls re-opens the OS file browser.

## The fix

1. **Render the editor outside the label.** In `src/components/ImageUploader.tsx`, mount `ImageEditorDialog` through `createPortal(..., document.body)` so the full-screen editor is a top-level DOM node and no longer a descendant of the label or the form field. Same treatment for any other place that mounts the editor inline.
2. **Stop labels from swallowing unrelated clicks.** Change `Field` to a `<div>` with a plain text caption instead of a `<label>` wrapper, so image uploaders (and any future rich control) inside a field can't accidentally trigger the field's inputs. Text inputs keep working; they just lose click-the-caption-to-focus, which no longer applies since the caption isn't tied to a single control.
3. **Belt and braces inside the uploader.** Keep the upload button's own `<label>` as the only file-input trigger, and give the hidden input an explicit `onClick` stop-propagation guard so a stray bubbling click can't reopen the picker while the editor is open.

## Verification

Typecheck, then a Playwright pass at a 390x844 mobile viewport on `/profile/edit`: open the avatar uploader, tap/drag on the crop surface, tap the bottom action row and the Options sheet, and confirm no file-chooser event fires; then confirm the upload button still opens the picker and Done still returns a cropped image.

## Out of scope

No changes to crop math, gestures, export quality, or upload/storage behavior.
