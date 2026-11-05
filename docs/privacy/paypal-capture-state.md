# PayPal capture state (audit F04)

Status: **implemented on a branch, not merged, not deployed.** Payments remain disabled; nothing here enables them.

## The defect

`captureOrder` in `src/lib/paypal.server.ts` returned the **order's** status. PayPal can report an order as `COMPLETED`
while its capture is still `PENDING`. The audit's mocked response was mapped to `COMPLETED` and passed
`paypalPaymentMatches`, and the checkout then recorded a verified payment, which grants paid participation before the money
has settled. Running the pre-fix mapper on that response reproduces it.

## The rule now

- **Parsing.** `parseCaptureResponse` reads the capture itself: its id, status, amount, currency and payee (the capture's,
  else the purchase unit's), and the decline reason. The order status is kept for the record only. No capture is reported
  as `MISSING`, and more than one as `AMBIGUOUS`.
- **Recording.** `recordCaptureOutcome` (`src/lib/paypal-capture.server.ts`) is shared by checkout and settlement:

  | Capture                                          | Result                                                                         |
  | ------------------------------------------------ | ------------------------------------------------------------------------------ |
  | `COMPLETED`, exact amount, currency and payee    | the capture is stored on the order, then exactly one verified payment          |
  | `PENDING` (matching)                             | order `capture_pending`; nothing granted; the client says PayPal is processing |
  | `DECLINED`, `FAILED`, missing, ambiguous         | order `failed`; nothing recorded                                               |
  | `COMPLETED` but wrong amount, currency or payee  | refunded (`refunded`, or `unrecorded` if the refund fails); never verified     |

- **Retries and concurrency.**
  - Checkout first claims the order (`created`/`approved` to `capturing`, conditionally). Of concurrent or duplicate
    calls, one captures; the others get "pending" and capture nothing.
  - The capture request carries `PayPal-Request-Id: capture-<order>`, so PayPal treats a retry as the same capture.
  - A capture call that errors leaves the order `capturing` (unknown outcome, nothing granted) for settlement.
- **Database** (`20261108170000_paypal_capture_state.sql`):
  - capture columns on `paypal_orders`, plus `capturing` and `capture_pending`;
  - `captured` requires a `COMPLETED` capture, and a capture id is unique;
  - checkout payments carry `paypal_order_id`, which only BallaCity can set. One payment is allowed per order and per
    capture.
  - A verified checkout payment is refused unless its order records a `COMPLETED` capture with the same id, player,
    game, amount and currency. This holds even for the service role.
  - Manual PayPal proofs (no checkout order) are unaffected.
- **Later settlement.** `settlePendingPayPalOrder(orderId, deps)` (`src/lib/paypal-settlement.server.ts`, service only):
  - it re-reads the capture from PayPal (`GET /v2/checkout/orders/{id}`) and records it the same way;
  - it leaves an order that is still `capturing` alone for 15 minutes;
  - it claims the order, so it never races a checkout retry.

  It is **not wired** to a webhook or schedule. When payments are enabled, call it from an operator job or from a
  verified PayPal webhook handler for `capture_pending` and stale `capturing` orders.

## Tests

- `src/lib/paypal.functions.test.ts`:
  - the audit's response;
  - `DECLINED`/`FAILED`;
  - missing and ambiguous captures;
  - amount, currency and payee mismatch (refunded);
  - capture stored before the payment;
  - retry after success;
  - a lost claim (concurrent or duplicate call);
  - an order in `capturing`/`capture_pending`;
  - a duplicate record (`23505`);
  - an unknown capture outcome.
- `src/lib/paypal.server.test.ts`: the parser.
- `src/lib/paypal-settlement.server.test.ts`:
  - pending, then `COMPLETED` (verified once);
  - still pending;
  - declined;
  - in flight;
  - a lost claim;
  - not settleable;
  - duplicate settlement.
- `supabase/tests/546_paypal_capture_state.test.sql` covers the database rules.
