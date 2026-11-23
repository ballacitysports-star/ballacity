# Managed-account handover at 18

Owner instruction 2026-11-21 ("do all 3 steps as your best recommendation"): the open question from
[guardian-link-age-18.md](guardian-link-age-18.md) is answered with a **guardian-started, adult-completed handover**.

A managed account (`public.managed_accounts`) has no sign-in of its own: the managing guardian is the only way in. The
18 rule (20261125200000) deliberately does not end the link of a managed account that has turned 18, because that would
strand the account. It only tells the managing guardian once. Until now nothing could give such an adult their own
account. This does.

It changes nothing for a minor. It only ever acts on a **known adult** (`private_sec.is_known_adult`: a stored birthday,
`age()` 18 or more; an unknown birthday is not an adult), and it fails closed everywhere: any error leaves the account
managed and linked.

| Piece                  | Where                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration              | `supabase/migrations/20261128100000_managed_account_handover.sql`                                                                                                                                                |
| SQL test               | `supabase/tests/991_managed_account_handover.test.sql` (251 assertions)                                                                                                                                          |
| Rollback               | `docs/rollbacks/20261128100000_managed_account_handover.down.sql` (guarded; rehearsed)                                                                                                                           |
| Server (guardian)      | `src/lib/managed-handover.functions.ts` (`startManagedHandover`, `cancelManagedHandover`)                                                                                                                        |
| Server (adult)         | `src/lib/managed-handover.server.ts` (claim, sign-in record, finish, one-time sign-in); `lookupManagedHandover`, `completeManagedHandover` in the functions file                                                 |
| Shared words and rules | `src/lib/managed-handover.ts`; sentences in `src/lib/user-error.ts` (`HANDOVER_*`)                                                                                                                               |
| Email                  | `src/lib/email-templates/managed-handover.tsx` (registered in `registry.ts`; fixed subject, plain names only)                                                                                                                                     |
| Parent Center          | `src/components/child/ManagedHandoverCard.tsx` (inside the child's panel in `src/routes/parent.index.tsx`), hooks in `src/lib/use-managed-handover.ts`                                                           |
| The link page          | `src/routes/handover.$token.tsx` and `src/components/handover/HandoverClaim.tsx`; `/handover` is a public route (`root-gate.ts`)                                                                                 |
| Tests                  | `managed-handover.test.ts`, `managed-handover.server.test.ts`, `email-templates/managed-handover.test.tsx`, `managed-handover.functions.test.ts`, `ManagedHandoverCard.test.tsx`, `HandoverClaim.test.tsx`; `e2e/managed-handover.spec.ts` (written, not run) |

## 1. How managed accounts work today (read from the code, not from the summary)

**Creation.** A verified adult guardian adds a child in the Parent Center. `createManagedChild`
(`src/lib/managed-children.functions.ts`) calls the auth Admin API with the service role: an email that cannot receive mail
(`m<random>@managed.invalid`, `.invalid` is reserved by RFC 2606), `email_confirm: true`, **no password**, and
`app_metadata: { managed: true, managed_by: <guardian id> }` (only the service role can write `app_metadata`, so a person
cannot give it to themselves). Then, as the guardian, `provision_managed_child()` writes in one transaction: the
`managed_accounts` row, the birthday (which sets `profiles.age_cohort`), the verified `guardian_links` row, the consent
record where the cohort needs one, `child_controls`, the guardian's acceptance of Terms and Privacy on the child's behalf
(`legal_consents.accepted_by`) and a `family_audit_log` row. It refuses an adult birthday, so a managed account is always
created as a minor.

**How the guardian signs in.** `startManagedSession` checks the caller is `managed_by` for that account (the database row
and `app_metadata`), then `admin.generateLink({ type: "magiclink" })` and returns only the hashed token. The browser
redeems it with `verifyOtp`, parks the guardian's own session in `localStorage` (`openrun:guardian-session`) and becomes
the child (`src/lib/managed-session.ts`). A second path exists in the database only: `managed_device_pairings`
(drizzle 0002; `create_device_pairing` / `revoke_device_pairing`, guardian-only). Nothing in `src/` calls it today, but the
table and functions are live, so a handover revokes linked pairings.

**What marks an account as managed.** Three places, and a handover must change all three or the account is not "normal":

1. `public.managed_accounts` (the row; `managed_by` is `ON DELETE RESTRICT`, so a guardian cannot be deleted while managing).
2. `auth.users.raw_app_meta_data.managed` / `.managed_by` (becomes `app_metadata` in the session; `isManagedUser()` reads it).
3. The placeholder address `@managed.invalid` (`isManagedEmail()`): the auth-email webhook acknowledges and sends nothing
   for it, and several screens hide or rename it.

There is no "managed" column in `profiles`, no RLS policy on another table keyed on `managed_accounts`, and no notification
state tied to it. Removing the row ends the managed exemption in `private_sec.guardian_authority_ended`, so the rule from
20261125200000 then cuts the guardian off in every reader at once.

### 1a. Every reader of `managed_accounts`

Found by replaying every migration into a scratch database and listing every function, policy, view and foreign key whose
current definition mentions `managed_accounts` or `is_managed_account`, then grepping `src/`.

| Reader (current definition)                                                                                                        | What it does with it                                                                         | After a handover                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Table policy "Managed accounts visible to manager, child and moderators" (SELECT)                                                  | the manager, the account and moderators read the row                                         | the row is gone                                                                                          |
| FK `managed_by` → `auth.users` `ON DELETE RESTRICT`; FK `child_user_id` `ON DELETE CASCADE`                                        | a guardian cannot be deleted while managing; deleting the child deletes the row              | no longer manages: the guardian can delete their account (the handover row itself cascades away)         |
| `private_sec.guardian_authority_ended` (20261125200000)                                                                            | a known adult is out of any guardian's authority **unless managed**                          | true for the person from the moment the row is removed: every #452 reader cuts the guardian off          |
| `private_sec.end_adult_guardian_links` (the daily sweep, 20261125200000)                                                           | never ends a managed account; notifies the managing guardian once; reports `managed_waiting` | nothing left to do for this person: the handover already ended the links and told both sides (section 3) |
| `public.notify_guardians_of`                                                                                                       | also notifies `managed_by` of a managed player                                               | no longer notified                                                                                       |
| `public.revoke_guardian_link`                                                                                                      | refuses ("delete the child instead") to unlink the managing guardian                         | unchanged; not reached, the link is already ended                                                        |
| `private_sec.guardian_approver_eligible`                                                                                           | a managed account can never be a guardian's approver                                         | the person can approve for a child of their own (they are an adult with their own sign-in)               |
| `public.provision_managed_child`                                                                                                   | writer; a managed account cannot be a guardian                                               | unchanged                                                                                                |
| `public.create_device_pairing`, `public.revoke_device_pairing`                                                                     | guardian-only, require the row                                                               | refused once the row is gone; linked pairings are revoked by the handover                                |
| `public.is_managed_account`, `private_sec.is_managed_account`, `wrap_oracle_helpers`                                               | the e2e probe; contained as an oracle                                                        | false                                                                                                    |
| New: `guardian_managed_handovers`, `start_`, `cancel_`, `managed_handover_lookup`, `claim_`, `release_`, `finish_managed_handover` | this feature                                                                                 | see section 2                                                                                            |
| `src/lib/managed-children.functions.ts` (`createManagedChild` limits, `deleteManagedChild`, `startManagedSession`)                 | guardian reads their own rows through RLS                                                    | nothing to find: no longer listed, cannot switch in                                                      |
| `src/lib/child-safety.functions.ts` `listMyChildren`                                                                               | sets `managed` on each child card                                                            | the child is no longer in the list at all (the guardian link is out of force)                            |
| `src/lib/account.functions.ts` `deleteMyAccount`, `src/lib/account-purge.server.ts`                                                | refuse to delete a guardian who still manages a child                                        | the guardian can delete their account                                                                    |
| `src/components/child/GuardianProfileCard.tsx` `useIsGuardianAccount`                                                              | a guardian is someone who manages or is linked to a child                                    | unchanged                                                                                                |

Readers of the **sign-in record** instead of the table (`isManagedUser`, `managedByOf`, `isManagedEmail`,
`displayEmail`, `emailLocalPart`): `ProfileSwitcher`, `ManagedSessionBanner`, `DeleteAccountButton`,
`NotificationsPanel` (push prompt), `use-parent-mode`, `onesignal`, `settings`, `account.security`, the game pay page and
`pay-entry-gate`, `legal-consent.functions`, `refuseManagedCaller` in the account and managed-children functions, the
auth-email webhook, `UsersTab`, `admin.index`, `user-prefs-store`, `games.$gameId.index`. All of them key on
`app_metadata.managed === true` or the placeholder address, which is why the handover rewrites both before the account
stops being managed (section 2, step 3).

`managed_profile_names` (20261125100000) is about a host's view of names and has nothing to do with `managed_accounts`.

## 2. The handover

### The flow, and what each person sees

1. **Guardian, Parent Center.** For a managed account whose person is 18 or over, the child's panel shows **Hand over
   _First_'s account**: "_First_ is 18 or over. This account has no sign-in of its own, so you are the only way in. When
   _First_ is ready, you can hand it over…". For a minor, an unknown age, or when the migration is not applied, nothing is shown.
2. **Guardian, address.** They enter the adult's own email address. The panel says to use an address only that person can
   open, not their own, not one that already has a BallaCity account.
3. **Guardian, confirmation.** The panel names the address, says nothing changes until the adult opens the link and
   confirms, that the link works once and expires in 7 days, what changes when they do (the account is theirs; the family
   link ends; the guardian can no longer see or change its settings; their games, teams and videos stay), and asks them to
   tick "This is _First_'s own email address, not mine." Then **Send the email**.
4. **The app's server** makes the token and calls `start_managed_handover` with the signed-in guardian's id (service role
   only, see section 3); **the database** checks everything and stores a pending handover with the token's hash. The app
   emails the link. If the email cannot be sent the handover is cancelled and the guardian is
   told ("We couldn't send the email, so nothing was changed").
5. **Guardian, waiting.** The panel reads "Waiting for _First_": the masked address, the expiry, "Until _First_ finishes it,
   nothing has changed: you still manage the account as usual", and **Cancel handover**. Before the adult finishes, the
   account behaves exactly as today: the guardian can still switch in, the device pairing and every session still work.
6. **The adult, the email.** "Your BallaCity account is ready to hand over": who started it, what happens if they open the
   link (confirm it is them, choose a password; the account is theirs; the person who managed it can no longer see or change
   it), the 7 days, and "If you were not expecting this, ignore this email: nothing changes unless you open the link and
   confirm."
7. **The adult, the page (`/handover/<token>`, opens signed out).** It shows who is handing over which account and a masked
   address, and a box "This is my account, and I want to take it over." Nothing happens until it is ticked and the button is
   pressed. Then the server does the steps in section 2a, and the adult is signed in with a one-time link and asked to choose a
   password (8 or more characters; it goes from the browser straight to the sign-in service, never through our server).
   Afterwards: "Done. This account is yours."
8. **Both, afterwards.** The guardian is told once ("Account handed over: _First_ now has their own sign-in. Your family
   link with them has ended…") and the person leaves the Parent Center. The adult is told once ("This account is yours…").
   Cancel and expiry change nothing about the account; expiry tells the guardian once ("Handover not finished").

### 2a. What the server does when the adult confirms (`managed-handover.server.ts`), in this order

1. `claim_managed_handover`: re-checks everything, refuses an address that was taken since, and takes a two-minute claim so
   only one finisher runs and the guardian cannot cancel under it.
2. Reads the sign-in record. It must be either the managed placeholder of the guardian the database names, or the half-done
   record an earlier attempt of this same handover left (the adult's confirmed address, not marked managed). Anything else
   stops here, releases the claim and says so.
3. Admin API: the adult's address, `email_confirm: true`, `app_metadata: { managed: false, managed_by: null }` and a
   **random throwaway password** (32 random bytes, never stored, logged or returned). It replaces any password a switched-in
   guardian may have set; the adult chooses theirs in step 5.
4. `finish_managed_handover`: **refuses unless the sign-in record already shows the adult's confirmed address and no longer
   says managed**, then in one transaction: removes the `managed_accounts` row; revokes linked device pairings; deletes every
   session and refresh token of the account (so a session the guardian opened while switched in dies); **replaces every
   credential a guardian could have planted** (step 2b of the function: the stored password becomes a fresh random one, every
   row in `auth.one_time_tokens` and every legacy token column is cleared, so a magic link the guardian made for themselves
   stops working, a pending email or phone change is dropped, phone number, second factors and every identity that is not
   `email`, such as a linked OAuth account, are removed; each step is skipped where the auth schema in use lacks the table or
   column); ends each active guardian link as the 18 sweep does (its triggers write the family audit row and clear that
   guardian's approvals on requests that are not yet a place; recorded in `guardian_link_age_events` so a support-approved
   birthday correction that makes the person a minor again puts the links back); notifies both sides once; clears the address
   and token hash; writes `managed.handover_completed`.
5. Admin API `generateLink({ type: "recovery" })`: the one-time sign-in so the adult can choose a password in the browser.

**Why the database clears the credentials and not only the app.** Nothing server side stops a switched-in guardian from
calling `updateUser({ password })` from the browser console (the app only redirects away from the security page, and the
auth-email hook covers email changes, not passwords). So the design does not assume a managed account has no password: at
completion the account keeps nothing the guardian could have put there, and a password the guardian set is replaced even if
the adult stops before the password page.

**What happens when something fails, decided from what the database says afterwards and never from the shape of the failure.**
After a failed or doubtful step 4 the app asks `managed_handover_state` (service role only, no secrets: does the managed row
exist, who manages it, is a handover pending, is a claim live):

- step 3 fails: nothing was finished; the claim is released.
- step 4 failed and the managed row is still there: the handover did not commit, so the sign-in record is put back (a fresh
  placeholder address, `managed: true`, `managed_by` restored) and the claim is released. The handover stays pending.
- step 4 failed or returned `HANDOVER_INVALID` and the managed row is **gone**: it did commit (the answer was lost, or a
  second run lost the race to a first one), so the handover is complete: the record is never put back and step 5 goes on.
- the answer was lost with no database code (a transport error) or the state cannot be read: nothing is put back on a guess;
  the adult is told to wait two minutes and open the link again (`HANDOVER_UNSURE`). The claim runs out by itself.
- the process dies, or the put-back itself fails, after step 3: the record is half done (the adult's address, not managed)
  while the managed row, the guardian link and the pending handover remain. Three things repair it, in the order they
  happen: (a) `reconcileManagedRecord`, run when the guardian cancels, starts again or switches in, puts the placeholder and the
  managed flag back whenever the managed row exists and nobody is finishing it (it re-reads the state right before writing,
  and never touches an account whose row is gone); (b) a new start for that same address is allowed, because the account's
  own current address is not "taken by another account"; (c) the adult can open the same link again: step 2 accepts the
  half-done record and goes on to finish. Cancel and expiry change only the handover row in the database (it cannot reach
  the sign-in service), which is why the app runs (a) after a cancel and the guardian's next switch-in runs it too.

If only step 5 fails the handover is complete; the page tells the adult to sign in with their address and use
**Forgot password**, which works because the address is confirmed.

### 2b. Why this design, and where it differs from the recommended option

The recommended option said to set the email on the auth user at the start and send a one-time email. This build keeps the
guardian-started, adult-completed shape and every guardrail, and differs in three places, each for a reason found by reading
the code:

- **The address goes on the sign-in record when the adult confirms, not when the guardian starts.** Setting it at the start
  would change an account that must "behave exactly as today": `isManagedEmail` would stop matching (so the auth-email
  webhook would start sending mail to it, and `displayEmail`, `emailLocalPart` and the guardian's own `generateLink` would
  all see a real address); a confirmed real address would let anyone who owns that mailbox use "Forgot password" and take the
  account **before** the database finalizes it, leaving a person with credentials on an account that is still managed and
  linked; and the repo's own comment says no migration puts a trigger on `auth.users`, so the database could not follow it.
  Doing it at completion, with the database refusing to finalize unless it is there, makes the order of events something the
  database checks rather than something it hopes for.
- **The password never reaches our server.** The server hands the browser a one-time recovery sign-in and the browser calls
  `updateUser({ password })`, exactly as `/reset-password` does. A server function that receives a plaintext password would be
  a new pattern with a new risk, for no gain.
- **It finalizes when the adult confirms they hold the mailbox, not when a password is set.** "Password set / email confirmed"
  were offered as equals. Waiting for the password would need a finalize callable by the new session, which means a client
  path to a function that ends a guardian's authority, and an in-between state in which the account has an adult's credentials
  but is still managed. Finishing at the confirmation has no in-between state, and an adult who stops before choosing a
  password is not locked out: their address is confirmed, so "Forgot password" finishes it.

## 3. The state machine and its guardrails

`private_sec.managed_handovers`: `pending` → `completed` | `cancelled` | `expired`. A pending row holds the address and the
token hash; an ended row holds neither (table checks enforce it). No API grant, row level security on.

| Rule                                                                                                                                                                                                                                                                   | Where                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Only the managing guardian starts or cancels it (an adult in good standing with a confirmed email, never itself a managed account, not suspended)                                                                                                                      | `start_managed_handover`, `cancel_managed_handover`                         |
| Only the app's server can start one: the token is made there and only its hash is passed in, so it never reaches the guardian's browser. A guardian who could call the function with a token they chose would follow their own link and skip the email                 | `start_managed_handover` is `service_role` only (tested)                    |
| Only for a **known adult**: a minor and an unknown age are refused; `finish` and `claim` re-check, so a support-approved correction to a minor stops it                                                                                                                | all four                                                                    |
| One pending handover per account; one waiting per address                                                                                                                                                                                                              | unique indexes                                                              |
| The address must be plain and 254 characters or fewer, not a `@managed.invalid` placeholder, not an existing account (any case), not another pending handover's, and **not the guardian's own mailbox** (case, `+tag`, and Gmail dots and `googlemail.com` normalised) | `start_managed_handover`; `claim` re-checks "taken"                         |
| 7 days to complete; expires lazily (every start closes every overdue handover, not only this account's, so an overdue one never keeps its address reserved; cancel and claim close this account's) and daily by sweep when `pg_cron` exists; the guardian is told once                                                                                                                                 | `expire_managed_handovers`                                                  |
| Cancel by the guardian, not while the adult's step is running (the two-minute claim); the claim test is part of the `UPDATE` itself, so a claim that commits while the cancel waits cannot be cancelled underneath the adult                                                                                                                                                                                   | `cancel_managed_handover`                                                   |
| Limits: 10 attempts per guardian per day (refused addresses count, so the address check can tell whether an address has an account at most ten times a day) and 3 starts per account per day                                                                           | `start_managed_handover`                                                    |
| The token: 32 random bytes, only its SHA-256 is stored, unique, cleared when the handover ends; the page is `noindex`, `no-referrer`, never remembered as a return path                                                                                                | `managed-handover.server.ts`, route, `last-visited.ts`, `safe-next-path.ts` |
| No client can start, finish, claim, release, look up by token or read the state; the app's server (service role) can                                                                                                                                                                   | grants (tested as `authenticated`, `anon`)                                  |
| Nobody but the managing guardian reads a pending handover (masked address only)                                                                                                                                                                                        | `guardian_managed_handovers()`; table has no grant                          |
| Audit: `managed.handover_started` (domain and a short hash of the address, never the address), `_refused` (the single word "refused": the child and the linked guardians can read this table, so the finer reason is not kept there), `_cancelled`, `_expired`, `_completed`                                                                                                        | `family_audit_log`                                                          |
| Fail closed: `finish` is one transaction (tested with a forced failure: nothing it did is kept); the app puts the sign-in record back only when the database says the managed row is still there, and a repair (`reconcileManagedRecord`) covers a step that died half way (section 2a)                                                                                                                      | SQL and server                                                              |
| The app keeps working without the migration: `guardian_managed_handovers` missing reads as "no handover", start and cancel say "isn't available yet"                                                                                                                   | `use-managed-handover.ts`, functions                                        |
| The email: a fixed subject and only plain names (letters, spaces, apostrophes, hyphens, 40 characters) in the body, so a guardian cannot put text of their choosing in mail sent under our name; at most 10 a day per guardian, 3 per account | `managed-handover.tsx`, `safeHandoverName` |
| Neutral, kind wording; no legal claim (a test reads every handover sentence for law, legal, consent, custody)                                                                                                                                                          | copy, `managed-handover.test.ts`, SQL test                                  |

What the guardian keeps after completion: nothing. The links end, the Parent Center, controls, audit and consent record
reads end through the existing #452 rule. `parental_consents`, `child_controls` and `legal_consents` are untouched, as in
#452 (a consent record revoked for a person with a stale minor cohort would lock them out).

### 3a. Negative controls and rehearsals (done locally, nothing applied anywhere else)

Each of these mutations of the migration was replayed into a scratch database and the SQL test run against it; every one made
the test fail (the counts are failing assertions, and "+ error" means the test also stopped on an SQL error): a minor may
start (6 + error); the guardian's own mailbox allowed (14 + error); an existing account's address allowed (10 + error);
finish without the sign-in record check (24); finish callable by clients (2); start callable by clients (3); sessions kept
(3); managed row kept (10); finish without a claim (17); the list shows everyone's handovers (5); expiry keeps the address
(1 + error); anyone cancels (6); anyone starts (11); finish skips the adult re-check (8); device pairing kept (1); no daily
limit (12); expired link still valid on the landing read (1); links not ended (7); cancel while being finished (7); token
kept after finish (1 + error); managing guardian not told when their link row was gone (1).

Added with the fix round: the password a guardian planted is kept (2); one-time tokens kept (1); the legacy token columns kept
(1); the phone number kept (1); a linked OAuth identity kept (1); a second factor kept (1); a start expires only its own
account's overdue handover (4); the refusal audit row keeps the fine reason (1); the state read never reports a live claim
(1); the state read callable by clients (1); the adult boundary moved to "strictly over 18" (4); the cancel refuses even a
claim that ran out (54); finish accepts a claim that ran out (17).

Ledger route, rehearsed on a replay made without the file (twice: once on the first build, again on the fix round): a copy with
the wrong md5 rolls back and leaves nothing (object fingerprint `3460|4e5e82fd`, equal to the replay without the file); the
good copy applies, and its fingerprint `3472|35558105` equals a full replay with the file; a second run stops on the ledger key
and changes nothing. Rollback: refuses without the confirmation, refuses when a function changed, refuses while a handover is
being finished, restores the fingerprint exactly (a pending handover is dropped with its table), and the migration applies
again afterwards.

## 4. Residual risk, plainly

- **A guardian who supplies an email address they control.** The account is already under their control: they can switch
  into it today. Nothing we can check proves that an address belongs to a particular adult, and a guardian who is determined
  to keep control can type an address of their own that we do not recognise (a second mailbox, a mailbox at another provider).
  This cannot be fully removed. If they then follow the link themselves, tick the box and choose a password, they hold the
  adult's credentials and the guardian link is gone.
- What was added to reduce it: the address cannot be theirs (same mailbox, `+tag` and Gmail-dot variants refused) or any
  existing account's; every refused address and every start is counted (ten a day per guardian), so it cannot be used to probe much; the guardian is asked
  to confirm "not mine" and the page asks the adult to confirm "this is my account"; the audit row names the domain and a hash
  so a moderator can see who handed over to whom and spot a pattern; the adult receives an email that says who started it and
  that nothing changes unless they act; the handover is cancellable and expires; the email has a fixed subject and plain names only, so it cannot carry text of the guardian's choosing; and completion ends
  the guardian's sessions and device pairing and **replaces every credential they could have planted while switched in** (a
  password, a magic link, a pending email or phone change, a linked OAuth account, a second factor; section 2a), so after it
  the guardian holds nothing but a record that it happened.
- **Sessions already issued.** The handover deletes every session and refresh token, but an access token the guardian already
  holds stays valid until it expires (the auth service's access-token lifetime, an hour by default). PostgREST validates the
  token, not the session. That is the same window as any password reset or sign-out in this stack. What that token can still do is limited: the auth
  service's own calls (for example `updateUser`) look the session up, and the session is gone.
- **The address check is a small account-existence oracle.** A refused address reads "can't be used" whether it already has an
  account, is waiting on another handover, or is a placeholder, and the audit row says only "refused" (the child and linked
  guardians can read that table). A guardian with a managed adult can learn at most ten such answers a day.
- **A mailbox the adult does not control** (a typo that is a real address). The link goes to a stranger who can then take
  the account. The masked address on both screens and the guardian's confirmation are the only check. Rate limits and the 7-day
  expiry bound the window.
- **Plus-addressing and aliases at other providers** are not detected as "the guardian's own mailbox".
- **The stored age cohort still lags.** The handed-over adult's `profiles.age_cohort` may still read a minor cohort (it is set
  when a birthday is saved and never ages). #452 already makes the guardian's switches, the payment gates and team chat treat a
  known adult with no guardian authority as an adult; other readers of the stored cohort are the age-cohort stream's work.
- **The #452 notice** to a managing guardian whose managed account turned 18 said "Contact support to plan handing it
  over" when this shipped. Its function was not touched here (the rollback of 20261125200000 checks its definition); the
  wording changed in a later migration, `20261130100000_managed_notice_points_to_handover` (see section 7, item 1). Notices
  already sent keep the old words.

## 5. What was not built

- No identity-document or age-verification check of the adult; no way to verify that the address holder is the account's person.
- No cooling-off period or second confirmation from anyone but the guardian and the address holder.
- No resend: to send again the guardian cancels and starts again (the per-account limit is 3 a day).
- No change to who may sign in during a pending handover (the guardian can; that is the point of "nothing changes yet").
- No admin screen for handovers: moderators read `family_audit_log` (`managed.handover_*`).
- No handover for a minor, for an unknown age, or by an organisation or a moderator.
- Nothing about consent law: whether handing a managed account to an adult needs any consent or notice wording is a question
  for the needs-legal issues, not answered here.

## 6. Applying, verifying and rolling back

Migration `20261128100000` needs `20261125200000` applied first (it stops with a message otherwise). It adds one table
and twelve functions, schedules one `pg_cron` job when the extension is there, and changes no existing object. Nothing is
applied by this branch to production or to the hosted sandbox. The app is safe either way round: before the migration the
Parent Center shows nothing and start says "isn't available yet"; with the migration and an old app, nothing links to it.

Things only a real auth service can show (to check in the serial E2E phase or on the local stack; they are assumptions the
mocked tests cannot prove):

1. Admin `updateUserById({ email, email_confirm: true })` updates `auth.users.email` and the `email` identity, so a password sign-in
   with the new address works afterwards.
2. `app_metadata: { managed: false, managed_by: null }` leaves `managed` not `true` in the next session's claims.
3. `generateLink({ type: "recovery" })` for a confirmed user returns a `hashed_token` that `verifyOtp({ type: "recovery" })` accepts.
4. After `finish_managed_handover`, the guardian's switched-in browser session cannot refresh and cannot call `updateUser`.
5. The password the adult chooses (browser, recovery session) replaces the throwaway one, and a password sign-in then works; a
   password a guardian set earlier no longer does.

Release order for `20261130100000_managed_notice_points_to_handover`: that migration makes the next sweep tell every managing
guardian of a managed adult to start the handover. Nothing gates the notice on the five checks above. Before applying it to
production, record in the release record whether the five were observed on a real auth stack (local Supabase stack or E2E). If
they were not, either hold that migration, or write in the release record that the notice goes out ahead of that proof. After
applying it, record the production `md5(pg_get_functiondef('private_sec.end_adult_guardian_links(integer)'::regprocedure))`; it
must equal the guard value in its rollback (`c3f95d699d9cb5e23c757eea4128f055`, computed on Postgres 16).

Rollback: `docs/rollbacks/20261128100000_managed_account_handover.down.sql` (guarded: needs
`SET app.confirm_managed_account_handover_rollback = 'yes'`, stops if any of the twelve functions changed, stops while a handover
is being finished). It cannot un-complete a handover; it cancels every pending one.

## 7. Owner decisions still open

1. ~~Whether the #452 managed notice ("Contact support to plan handing it over") should be reworded to point to the new Parent
   Center entry.~~ Reworded by `20261130100000_managed_notice_points_to_handover`: the notice now says the person is 18 or
   over, that the guardian still manages the account until they complete a handover, and where to start one ("Start handover"
   on their page in the Parent Center). Only that string changed in `private_sec.end_adult_guardian_links` (test 994 compares
   the definition with the old one by md5); no legal, consent or age-of-majority wording. Rollback:
   `docs/rollbacks/20261130100000_managed_notice_points_to_handover.down.sql`, which must run before the rollback of
   20261125200000.
   Decision 1 being done does not settle 2 and 3 below: the notice now steers guardians to the flow while they are still
   open, and the five real-auth checks in section 6 have no record yet.
2. Whether a handover should need a second factor beyond the mailbox (a code the guardian reads out, a waiting period, or a
   support review for addresses on the same domain as the guardian's). Not built; the residual risk above is the trade.
3. Whether handing over an account carries any legal consent or notice requirement. Not decided here; the issues #306-#313
   (needs-legal) were not touched and no wording about age of majority or consent was added.
