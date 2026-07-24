## Problem

In `DeleteAccountButton` (src/routes/settings.tsx), the "Permanently delete account" button stays disabled after the user types confirmation. Its `disabled` expression is:

```
busy || confirm !== "DELETE" || (hasPassword && !password)
```

Two likely culprits:

1. **Case-sensitive match.** `confirm !== "DELETE"` fails if the user types "delete" or "Delete". No hint is shown explaining why the button remains inactive.
2. **`hasPassword` false positives.** `hasPassword` is derived from `user?.identities?.some(i => i.provider === "email")`. For users signed in via Google, `identities` sometimes still contains an `email` provider entry (Supabase links providers by email), so the password field is required and, when left empty, keeps the button disabled with no visible reason.

## Fix

Edit only `DeleteAccountButton` in `src/routes/settings.tsx`:

1. Normalize confirm comparison: `confirm.trim().toUpperCase() === "DELETE"`.
2. Tighten `hasPassword` detection to the primary sign-in method:
   - Prefer `user?.app_metadata?.provider === "email"` (Supabase's canonical primary provider), falling back to identities only if `app_metadata.provider` is absent.
3. Add an inline helper line under the footer that explains the current blocker when the button is disabled ("Type DELETE to confirm" / "Enter your password"), so the user is never left guessing.
4. Keep all server logic, RLS, and `deleteMyAccount` untouched — pure UI/gating change.

## Verification

- Manually confirm the button enables when typing "DELETE", "delete", or " Delete " with valid password (email users) or without (social users).
- Extend `e2e/desktop-refresh-protected.spec.ts` or add a small Playwright check that opens Settings → Delete account, types "delete", and asserts the confirm button becomes enabled.