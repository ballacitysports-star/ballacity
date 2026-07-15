## Add confirmation prompts to join / leave actions

Wrap the join and leave button interactions on the game detail page with an AlertDialog so the user must confirm before the action fires.

### Files to change

1. **`src/routes/games.$gameId.index.tsx`**
   - Import `AlertDialog` primitives from `@/components/ui/alert-dialog` (already used elsewhere in the app, e.g. `RequestStatusPanel`).
   - Add local state `confirmAction: "join" | "leave" | null`.
   - Change the sticky CTA button's `onClick` from directly calling `handleJoin` to opening the dialog with the appropriate intent based on current status:
     - If currently joined/confirmed → open leave confirmation.
     - If not joined and the CTA would trigger a free join → open join confirmation.
     - Paid / approval-gated flows that navigate to `/pay` or submit an approval request stay as-is (they already have their own screens/confirmations). Only the direct join and direct leave paths get a prompt.
   - Render a single `<AlertDialog>` whose title/description/action label change based on `confirmAction`:
     - **Join**: "Join this game?" · "You'll be added to the roster. You can leave later if plans change." · confirm label "Join game".
     - **Leave**: "Leave this game?" · "Your spot will open up for someone else. You can rejoin if there's still space." · confirm label "Leave game", destructive styling.
   - On confirm, run the existing `handleJoin` logic (unchanged) and close the dialog. On cancel, just close.

### Out of scope

- No changes to `joinGame` / `leaveGame` in `src/lib/games-store.ts`.
- No changes to the pay flow, approval-request flow, waitlist, or host-side actions.
- No copy or testid changes to buttons that E2E specs match on — the button label stays "Join free" / "You're in · Tap to leave"; the dialog is an added layer. E2E specs that click the CTA once expect immediate action, so they'll need a follow-up click on the dialog's confirm button.

### E2E impact

Specs that exercise join/leave via the sticky CTA (e.g. `join-realtime-cross-views.spec.ts`, `join-cross-device-roster.spec.ts`) will need a follow-up click on the AlertDialog's "Join game" / "Leave game" confirm button after clicking the CTA. Plan updates those specs to click the confirm button in the dialog immediately after the CTA click. No assertions change.
