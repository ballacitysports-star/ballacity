## Problem

On the trainer profile page (`src/routes/trainers.$trainerId.index.tsx` line 235), the avatar tile renders `{org.avatar}` as raw text. Since the create/edit flows now store a full URL (or `data:` preview) in `avatar`, the URL string is shown instead of the picture. Short initials still render fine because they're just text — that's why this only regressed after avatar uploads landed.

The cover image on line 203 already uses `<img>`, so it's unaffected.

## Fix

In the avatar tile, detect whether `org.avatar` is an image reference and render accordingly:

- If `org.avatar` starts with `http`, `https`, `/`, or `data:` → render an `<img>` filling the tile with `object-cover` and `rounded-3xl`, keeping the accent gradient as a fallback background.
- Otherwise → render the string (initials / emoji) as today.

Also fall back to initials derived from `org.name` when `org.avatar` is empty, so tiles are never blank.

Scope: only `src/routes/trainers.$trainerId.index.tsx`. No schema, DB, or upload-flow changes.
