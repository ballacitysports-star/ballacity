# Fix the onboarding page bouncing between date-of-birth and profile type

## Verified diagnosis

Observed in the live preview: the page flips every ~500 ms between
`/onboarding/age` and `/onboarding/account-type` (9 route changes in 4 seconds).

Two guards in the root gate disagree:

- The age guard skips its check on the age/consent screens, but sends the member
  to `/onboarding/age` from any other route while the account has no determined
  age.
- The profile-type guard is only skipped on `/onboarding/account-type`. It is
  therefore still active while the member sits on `/onboarding/age`, sees that no
  profile type is stored, and immediately redirects to
  `/onboarding/account-type` — where the age guard fires again.

Backend data confirms accounts in exactly this state: rows in `profiles` with no
stored date of birth (age cohort `unknown`) and no `account_type`, which is what
both guards react to.

```text
/onboarding/age  --(no profile type yet)-->  /onboarding/account-type
       ^                                              |
       +---------------(no date of birth yet)---------+
```

A second, related mismatch: the age screen leaves as soon as a birthday exists,
while the root gate only accepts a determined cohort/status. An account with a
stored birthday but an undetermined cohort would loop the same way.

## Plan

1. **Make the age step exclusive while it is active**
   - Treat the age/consent/parent/legal/safety screens as one "account setup"
     escape group for the profile-type guard too, so the type check cannot
     redirect away from the date-of-birth screen.
   - Keep age determination strictly ahead of the profile-type picker: no
     profile-type redirect until age status is resolved.

2. **Use one shared "where does this member belong" decision**
   - Route from the existing signup state machine (age status + cohort + whether
     a profile type exists) instead of two independent redirects that can each
     win.
   - Redirect only when the target differs from the current path, and never
     redirect twice for the same resolved state.

3. **Align the age screen's exit rule with the gate's entry rule**
   - The age screen should continue onward only when the server reports a
     determined cohort/status, not merely that a birthday row exists.
   - If a birthday is stored but the cohort is still undetermined, show a
     retry/error state rather than bouncing.

4. **Regression coverage**
   - Add a test for an authenticated account with neither a date of birth nor a
     profile type: it must settle on the date-of-birth screen with no further
     navigation.
   - Add a test for a stored birthday with an undetermined cohort: no loop.
   - Keep existing age-verification and onboarding-status tests unchanged.

5. **Verify in the running app**
   - Re-observe the current screen and confirm the path stays stable, then walk
     date of birth -> profile type -> app once through without a bounce.

## Technical scope

Changes are limited to the guard logic in `src/routes/__root.tsx`, the shared
routing helpers in `src/lib/age-verification.ts`, the onward-routing condition in
`src/routes/onboarding.age.tsx`, and focused tests. No schema, RLS, consent
policy, or page redesign changes.
