## Add payment policies section to the Payments tab

Surface the same payment configuration that hosts set in `/games/$gameId/payment-setup` at the top of the Payments tab on `/games/$gameId`, visible to both host and player views.

### What to display

Pulled from `game_payment_settings` for the game:
- **Payment deadline** — formatted date/time, with a "past due" indicator when in the past.
- **Refund policy** — free text, rendered with line breaks.
- **Payment instructions** — free text, rendered with line breaks.
- **Accepted payment methods** — list of the host's enabled methods (label + handle/identifier), same shape as the setup screen.

Fields render only when set; if none are configured, show a subtle empty state ("Host hasn't configured payment details yet"). For the host view, include a small "Edit payment settings" link to `/games/$gameId/payment-setup`.

### Implementation

- New presentational component `PaymentPoliciesCard` in `src/routes/games.$gameId.index.tsx` (or co-located file) that takes the settings + accepted methods as props.
- Extend the existing Payments-tab query (or add a sibling query) to also fetch `game_payment_settings` for the game and the host's `host_payment_methods` rows referenced by it, reusing helpers from `src/lib/payments.ts`.
- Render `PaymentPoliciesCard` at the top of the Payments tab, above both the host approval queue and the player status card.
- No schema changes, no mutation logic — read-only display.

### Verification

- `bunx tsgo --noEmit`.
- Manually confirm: with policies set, both host and player see the card; with none set, empty state renders; deadline past shows the past-due badge.
