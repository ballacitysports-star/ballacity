## Goal
Let people type a birthday by hand (not just use the native date picker) everywhere a birthday can be edited.

## Where it applies
Both editable birthday fields — Edit profile (`src/routes/profile.edit.tsx`) and onboarding (`src/routes/onboarding.welcome.tsx`) — already render the same shared component, so a single change covers both:
- `src/components/profile/ProfileBasicsFields.tsx` (the `Birthday` field)
- `src/components/profile/ProfileFormPrimitives.tsx` (`validateBirthday`)

## What to build
Replace the single `<input type="date">` with a combined control:
- A free-text input as the primary entry, accepting `MM/DD/YYYY` and `YYYY-MM-DD` while typing, with light auto-formatting (auto-insert `/`) and a `MM/DD/YYYY` placeholder.
- A small calendar icon button next to it that opens the native date picker (a visually compact `<input type="date">`), keeping the existing tap-to-pick behavior.
- Both paths write the same canonical `YYYY-MM-DD` string back through `onChange({ birthday })`, so save logic and payload building stay untouched.

## Validation
- Extend `validateBirthday` with a parse helper that normalizes typed input to `YYYY-MM-DD`, returning the existing error messages for invalid, incomplete, or future dates.
- Validation runs on change (as today) and on blur; the inline error text and `aria-invalid` styling stay the same.
- Partially typed values don't show an error until blur, so the field isn't red while typing.

## Technical notes
- No data-model, payload, or persistence changes; `basics.birthday` remains `YYYY-MM-DD` or `""`.
- Existing callers in `profile.edit.tsx` and `onboarding.welcome.tsx` need no edits since they consume the shared component's `onChange`/`birthdayError` contract.
- Keep the input `inputMode="numeric"` and `maxLength={10}` for a good mobile keyboard.
