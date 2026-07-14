## Goal

Bring the host's Edit Game modal on `/games/$gameId` to feature parity with the initial "Host a game" form (`/create`) so a host can fully edit any posted game.

## Gaps today

`EditGameModal` in `src/routes/games.$gameId.index.tsx` (lines 1620-1845) is missing options the Create form exposes:

- No cover photo upload — only a raw image URL text field.
- Plain text input for venue address; Create uses `LocationAutocomplete`.
- No "Require my approval to join" toggle (payment settings `requires_approval`).
- No polished paid/free toggle + entry-fee UI (Create wraps price in a toggle).
- Sport picker is a select; Create shows the sport grid with emoji.
- Skill picker is a select; Create uses chips.
- Max players is a numeric input; Create uses a range slider (2–30) — align edit to same range/pattern.

## Changes

All edits stay in `src/routes/games.$gameId.index.tsx` (plus reading existing payment settings already loaded on the page).

1. **Extend `EditGameModal` props** to also receive current `requiresApproval` (from `settings.requires_approval`) and pass it back on save. Load it into local state.

2. **Cover photo section**: replace the plain URL field with the same upload UI as Create — preview, Upload/Replace/Remove, and Supabase Storage upload to the `game-covers` bucket using `${user.id}/…` path, then a long-lived signed URL. Keep an optional manual URL fallback if the host prefers to paste a link. Store the final URL in `image` state.

3. **Venue address**: swap the text input for `LocationAutocomplete` (already used in Create). Keep the separate Neighborhood field.

4. **Sport & skill pickers**: replace selects with the Create-style grid (sport) and chip row (skill).

5. **Paid game toggle + entry fee**: mirror Create's "Paid game" toggle that flips price between 0 and last non-zero value, and show the `$ … per player` input only when price > 0.

6. **Max players**: replace numeric input with the same range slider (min 2, max 30) plus the big lime count readout.

7. **Approval toggle**: add the `Require my approval to join` Toggle. On save, call `upsertGamePaymentSettings({ game_id, entry_fee: price, accepted_method_ids: settings?.accepted_method_ids ?? [], requires_approval })` in addition to `updateHostedGame(...)`. Show the same helper text when enabled.

8. **Save flow**: keep `updateHostedGame(...)` for game fields; wrap payment-settings upsert in try/catch and toast on failure without blocking the game update. Close modal on success.

9. **Keep existing sections** that aren't in Create: Neighborhood, Duration, Description, PositionsPicker, BlockedUsersSection — unchanged.

## Out of scope

- No changes to the Create page, hosted-games store, or DB schema.
- Payment methods management stays on `/games/$gameId/payment-setup`.
- No changes to non-host users or to the game detail page outside the modal.

## Verification

- Open a hosted game as the host → tap Edit → all Create fields are present and pre-filled from the current game/settings.
- Upload a new cover, change sport (positions reset like Create), toggle approval, save → detail page reflects updates and reloading the game shows the new cover, price/free state, and approval requirement.
- Non-host viewers still see no Edit button.
