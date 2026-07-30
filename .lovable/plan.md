## What's actually happening

Your sign-in telemetry has the answer. From the iPhone Safari attempts a few minutes ago (`auth_signin_events`):

```text
20:15:49  attempt   Safari / iOS
20:15:57  failure   "Sign in was cancelled"
20:15:58  attempt   Safari / iOS
20:16:09  failure   "Sign in was cancelled"
20:16:09  attempt   Safari / iOS
20:16:20  success
```

So Google sign-in isn't blocked — it's being reported as cancelled while it's still in progress, and only worked on the third try.

Why: when the app runs inside a frame (Lovable preview), the sign-in helper opens Google in a **new tab** on iOS and then polls that tab to see if it was closed. On iPhone Safari the original tab gets backgrounded/frozen as soon as you switch to Google, and the poll reads the Google tab as "closed" — so the helper rejects with `Sign in was cancelled` and our code shows an error toast, even though the sign-in is still running (and often completes moments later). Our current error handling treats that message as a hard failure.

## The fix

Stop treating an ambiguous "cancelled/closed tab" signal as a failure. Wait for the session instead.

1. **`src/routes/auth.tsx` — classify the outcome instead of erroring**
   - Add an "inconclusive" bucket for messages matching `cancelled` / `closed` / `timed out` (and any popup-closed variant).
   - On inconclusive: do **not** show an error toast. Enter a "Waiting for Google to finish…" state and poll `supabase.auth.getSession()` (e.g. every 1s for up to ~2 minutes) while `onAuthStateChange` also stays in play. First one to see a session wins → run the existing `goPostAuth` path.
   - Only if the grace window expires with no session, show a calm message: "We didn't hear back from Google" + **Retry** action.
   - Keep genuine provider/vendor errors and true "Popup was blocked" on the existing hard-error path.

2. **Make the waiting state visible and idempotent**
   - Keep the button in a busy/"Finishing sign-in…" state during the grace window instead of clearing `busy` immediately in `.finally()`.
   - Guard against double-handling if both the poller and `onAuthStateChange` resolve.
   - Cancel the poller on unmount / successful redirect.

3. **Fix the misleading iOS copy**
   - The current guidance tells iPhone users to disable Block Pop-ups. Only show that for a real `Popup was blocked` error, not for the cancelled/closed case.

4. **Telemetry**
   - Record a distinct event for the inconclusive case (e.g. `inconclusive_wait`) plus `success_after_wait` / `timeout`, so we can confirm from data that the false failures are gone instead of guessing.

## Notes

- On the published site (not framed), the helper does a full-page redirect and never opens a tab, so this specific failure is preview/framed-context specific — the change is safe there and just makes the flow quieter.
- No database or backend changes; work is confined to the sign-in screen's outcome handling and copy.

## Verification

- Re-run the Google sign-in on iPhone Safari and confirm no error toast appears mid-flow and you land signed in on the first attempt.
- Re-query `auth_signin_events` afterwards: expect `attempt → inconclusive_wait → success_after_wait` with no `failure / "Sign in was cancelled"` rows.
- Existing social-login E2E specs (`e2e/social-login-identity-cases.spec.ts`) plus a new case asserting an inconclusive helper result does not surface an error toast.
