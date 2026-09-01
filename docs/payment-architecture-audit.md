# OpenRun payment architecture audit (P2P safety)

## 1. What OpenRun is (and is not)

OpenRun is **not a payment processor** for game fees. Players pay hosts
directly inside Venmo, Zelle, Cash App, PayPal, or with cash. OpenRun stores
only:

- the host's **public payment handle** (username, payment link, or contact),
- the player's **claim** that they paid (amount, date, optional transaction id,
  optional screenshot),
- the host's **manual confirmation**.

OpenRun never holds funds and cannot move, refund, or reverse a payment. This
is stated in `PAYMENT_DISCLAIMER` (`src/lib/payment-states.ts`) and rendered by
`PaymentSafetyNotice` on both the player pay flow and the player payments panel,
and in the host approvals header.

## 2. No credentials, ever

The payment flow collects no card numbers, CVVs, bank/routing numbers, or
logins. Host payment methods (`payment_methods`) hold only `username`,
`payment_url`, `contact_info`, and free-text `instructions`. Player claims hold
amount / date / reference / screenshot. `FORBIDDEN_CREDENTIAL_HINT` documents
this rule for any future payment UI.

## 3. Canonical states

`src/lib/payment-states.ts` is the single source of truth for the seven states:

| State | DB representation |
|---|---|
| `payment_required` | fee > 0, no submission (or last one declined) |
| `instructions_shown` | client signal: host details opened |
| `payment_sent` | submission inserted (`status='pending'`) |
| `host_confirmation_pending` | `status='pending'` |
| `confirmed` | `status='verified'` (host only) |
| `disputed` | `status='disputed'` |
| `cancelled` | `status='cancelled'` + `cancellation_reason` |

Cancellation reasons: host cancelled, player cancelled, game cancelled,
weather, dispute, other.

## 4. Enforcement (server-side, not UI-only)

- `payment_submissions_state_guard` trigger: a player's insert must start in
  host review; only the host may move a claim to `verified` / `rejected`;
  dispute/cancel timestamps are stamped server-side.
- RLS: a player may update **only** their own row and **only** to
  `cancelled` / `disputed`. Marking "payment sent" can never self-confirm.
- `reviewPaymentAction` (server fn) verifies the caller is the host and uses
  `expectedFrom` optimistic concurrency so double taps are idempotent.

## 5. Scam protection

- Safety tips + pressure warning shown before payment; the pressure warning is
  emphasised on high fees.
- "Report a payment scam" is available on the pay flow, in the claim actions,
  and in the player payments panel. It files a `user_reports` row with
  `subject_type='payment'` and reasons `payment_scam`,
  `payment_not_received`, `payment_pressure`, feeding the existing
  `/admin/moderation` queue and audit log.
- Disputes are recorded on the claim itself with a reason, visible to both
  sides, and route resolution back to the payment app (OpenRun cannot refund).

## 6. Stripe audit — scope separation

Stripe in this project is used **only** for OpenRun's own platform
subscriptions (`/plans`): `src/hooks/useStripeCheckout.tsx`,
`src/components/StripeEmbeddedCheckout.tsx`, and the webhook at
`src/routes/api/public/payments/webhook.ts`.

- Stripe is never used for player→host game fees, and no P2P code path calls
  Stripe or the subscription webhook.
- Game-fee UI never references cards or Stripe branding; P2P copy names the
  host's own payment app.
- The webhook verifies its signature before processing and only touches
  subscription state.

Keeping these separate is deliberate: platform subscriptions are OpenRun
selling to a user (Stripe is appropriate), while game fees are two users
transacting with each other (OpenRun stays out of the money flow).
