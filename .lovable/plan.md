## Plan

1. **Confirm the failing request path**
   - Inspect the pay screen network behavior around `getGamePaymentSettings`, `get_host_payment_methods`, payment submissions, and join requests.
   - Keep the existing host-scoped RPC path intact so payment method data is still limited to the intended host.

2. **Make the pay screen tolerate optional lookup failures**
   - Change the pay screen load sequence so a failure or timeout in non-critical user-status reads, like previous submissions or join request status, does not blank the whole pay screen.
   - Keep payment settings and host payment methods as the required data for showing the payment UI.
   - If the host has no methods, show the existing empty state instead of the red retry error.

3. **Keep security behavior unchanged**
   - Continue using `listPaymentMethodsForHost()` through `get_host_payment_methods` only.
   - Do not reintroduce direct public reads from `host_payment_methods` on the pay screen.

4. **Add/adjust regression coverage**
   - Add an E2E case for pressing Pay Host where the pay screen still reaches either the ready UI or empty state without showing the full-screen payment-service retry when optional status reads are slow or unavailable.
   - Keep the existing tests that assert the RPC-only payment-method fetch and no cross-host leakage.

5. **Verify**
   - Run the targeted pay-screen E2E test(s) after implementation.
   - Check the rendered pay screen no longer shows “Couldn't reach the payment service — tap Retry” for the normal Pay Host flow.