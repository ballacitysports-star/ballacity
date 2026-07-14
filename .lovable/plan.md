Plan:

1. Make the game-detail payment CTA deterministic
   - Update the paid-game CTA path so tapping “Pay host” navigates directly to `/games/:gameId/pay` when payment is required and not already verified.
   - Avoid leaving the button in a stuck disabled/requesting state if navigation cannot complete.

2. Ensure the payment screen can load for all games
   - The pay route currently only resolves games from the static sample list, while the game detail page also supports hosted/user-created games.
   - Change the pay screen to resolve the same game sources as the detail screen so paid custom/hosted games do not hit “Game not found” instead of the payment flow.

3. Make external payment app launch reliable on mobile
   - Replace the payment URL anchors that rely on `target="_blank"` with a click handler that synchronously:
     - selects the payment method,
     - stores the auto-resume marker,
     - then opens/navigates to the payment URL in a mobile-friendly way.
   - Keep clear fallback instructions if the URL is missing or cannot be opened.

4. Preserve proof-upload recovery flow
   - Keep the existing return/resume behavior so after coming back from Venmo/Cash App/etc. the user lands at the proof upload section with the next steps visible.

5. Verify the flow
   - Use the preview to confirm tapping the game “Pay host” button loads the payment route.
   - Confirm tapping the method’s pay button runs the launch handler and leaves the proof step ready on return.