## Problem

The RLS SELECT policy on `host_payment_methods` is:

```
(is_enabled = true) OR (host_id = auth.uid())
```

This lets **any authenticated user read every enabled host's payment methods** — including `username`, `payment_url`, `contact_info` (email/phone), and `instructions`. Combined with `listMyPaymentMethods()` in `src/lib/payments.ts` which does `SELECT * FROM host_payment_methods` with **no `host_id` filter** (relies purely on RLS), the "My payment methods" panel on `/payments` renders every host's payment details to the current user. That's what the user is seeing as "payment option data showing in other users' profile".

## Fix

Tighten RLS so only the owner can read their own methods, and expose the minimum data needed for the pay screen through a security-definer RPC that filters by a specific host.

### 1. Migration

- Drop the broad SELECT policy on `host_payment_methods`.
- Add owner-only SELECT: `USING (host_id = auth.uid())`.
- Create `public.get_host_payment_methods(_host_id uuid)` — `SECURITY DEFINER`, `STABLE`, `SET search_path = public` — returns only the columns the pay screen needs (`id`, `host_id`, `payment_type`, `label`, `username`, `payment_url`, `contact_info`, `instructions`, `is_enabled`) filtered by `host_id = _host_id AND is_enabled = true`. Grant EXECUTE to `authenticated`.
  - Rationale: players paying a host legitimately need `username`/`payment_url`/`contact_info` for that one host, but should not be able to enumerate all hosts.

### 2. Client code (`src/lib/payments.ts`)

- `listMyPaymentMethods`: add explicit `.eq("host_id", user.id)` (defense in depth alongside the tightened policy).
- `listPaymentMethodsForHost(hostId)`: switch to `supabase.rpc("get_host_payment_methods", { _host_id: hostId })` so it keeps working under the new policy.

### Out of scope

- No UI changes; `/payments`, `/games/$gameId/payment-setup`, and `/games/$gameId/pay` continue to work with the same shapes.
- The unrelated "Couldn't reach the payment service" timeout is not touched here.

## Verification

- On `/payments` as user A, only A's own methods appear.
- On `/games/$gameId/pay` for a game hosted by B, B's enabled methods still render for the paying player.
- `SELECT * FROM host_payment_methods` from the browser as a non-owner returns 0 rows.
