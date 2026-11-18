# Paid path: what /games/<id>/pay checks, and what the database enforces

Source: the review of PR #428, "invite" finding 2 (low), e2e/invite-pay-and-join.spec.ts:404 (the spec is 172 lines long, so
the review's line number points at the game page's CTA it exercises, not at a line in the spec).
Investigated on the base of PR #428 (857592415a96).
Line numbers are for that base unless marked "after the fix".

## 1. The game page: the Link skips handleJoin

`src/routes/games.$gameId.index.tsx`

- L2769-2788: `lockedForNewJoin = gate.locked && !joined && !isPending && !isConfirmed && !isApproved`,
  `consentBlocksNewJoin = !alreadyInFlow && !participationDecision.allowed` (participationDecision =
  `canChildFeature("game_participation")`, L324). These two only feed `buttonDisabled`, the button's onClick (L2865)
  and its label.
- L2791-2794: `canEnterPaymentFlow = spotsLeft > 0 || joined || hasPaymentAttempt || isApproved`;
  `paymentAction = isPaid && !paymentCleared && approvalCleared && canEnterPaymentFlow && !parentAsk`. Neither
  `lockedForNewJoin` nor `consentBlocksNewJoin` (nor `canChildFeature("game_payments")`) is part of it.
- L2843-2856: when `paymentAction` is true the CTA is a `<Link to="/games/$gameId/pay">`, so `handleJoin` (L1268)
  and with it `needsRiskAcknowledgment` (L1269-1281, the "Before you join" dialog) never run.
- On a paid game with no host approval, `approvalCleared` is true from the start (L909), so a fresh viewer gets the
  Link at once. On approval games the viewer goes through `handleJoin` for the request (risk dialog shown then), and
  only gets the Link after approval.
- Even on the button path, `executeJoinAction` sends a paid, approval-cleared, unpaid viewer to /pay at L1016-1022,
  BEFORE its `gate.locked` check (L1126). On that path only the disabled button stops a locked game.
- `guardianOnlyJoin` (src/lib/guarded-open-join.ts:37) keeps a 13-15/under-13 viewer on a paid game on the ordinary
  "Pay Host" CTA on purpose ("the viewer gets Pay Host and the pay page's 'payments aren't available' message"), but
  until this fix the pay page had no such message before money could move; it only came back after a proof
  submission (src/lib/payments.ts:419-428).

## 2. What /pay checked before this fix

`src/routes/games.$gameId.pay.tsx` (base):

| Check                                                                                           | Where                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Signed in, else redirect to /auth                                                               | L249                                                               |
| Parent mode, else redirect to /parent                                                           | L253                                                               |
| Host approval required and not approved: "Waiting on host approval" card                        | L478-480, L615. Reads `settings?.requires_approval` only (see 5c). |
| A full roster: a soft warning, "This game just filled up — message the host before submitting." | showFilledUpWarning, src/lib/spots-urgency.ts:46                   |
| Nothing else                                                                                    |                                                                    |

Not checked: the game's join gate (cancelled, ended, in progress, host-closed, signup cutoff), the account's
participation consent (`game_participation`), the account's payment permission (`game_payments`: age group,
parental consent, unknown age), the guardian's approval for this game, host blocks, the game's age range, and the
risk acknowledgment. Everything below the approval card was offered: PayPal checkout (L684), the host's handles with
"Pay $X in Venmo/Cash App" deep links that open the payment app (L729), and the proof form (createPaymentSubmission,
L1411). If the settings row was unreadable, the card said "Host hasn't set up payment yet. Message the host directly
to arrange payment."

## 3. What the server enforces on this path

### 3a. PayPal checkout: fully gated before any money moves

`src/lib/paypal.functions.ts:73` `assertPaymentPreconditions` calls `public.paypal_payment_precondition` as the player
at order creation (`createGamePayPalOrder`, ~L405) and again right before the capture (`captureGamePayPalOrder`,
~L547). It fails closed. `private_sec.paypal_payment_block`
(supabase/migrations/20261111140000_paypal_payment_preconditions.sql L58-189) refuses for: cancelled or completed
game, own game, invalid payee, unknown age, `game_payments_allowed` false, `child_game_participation_allowed` false,
blocked by host, already paid, payment in progress, host approval required, guardian approval missing
(`game_payment_guardian_ready`), age range, over by the clock, joins closed or past the cutoff (unless approved), and
a full roster. **No gap on the PayPal path.**

### 3b. Manual payment claim (payment_submissions INSERT by the player)

RLS: "Players create own submissions" `WITH CHECK (player_id = auth.uid())` (20260603200959 L93-94).
BEFORE INSERT triggers:

- `enforce_approval_before_payment` (latest: 20261103140000 L205-237): approved request needed only when the payee's
  settings row says `requires_approval`. A missing row means no approval needed.
- `enforce_game_payment_cohort` (20261111120000 L571-605) with `game_payments_allowed` (L557-565): refuses
  under-13, 13-15, unknown age, and `child_features_locked` (parental consent required and not approved,
  20260902201858 L36-44). It also refuses a payee who may not coordinate payments.
- `payment_submissions_guardian_first`, i.e. `enforce_guardian_before_payment` (20261111100000 L52-68): a player with
  an active guardian link needs a guardian-approved request for this game that is pending or approved and still
  valid. This applies to signed-in writers only, which a manual claim always is.
- `aa_payment_destination_trg` (20261103140000 L82-95): the payee must be the game's host.
- state guard, credentials, refund-field locks (no bearing here).

NOT checked on the claim: the game's join gate (cancelled, completed, over by the clock, joins_closed, signup
cutoff), capacity, `child_game_participation_allowed` (a guardian's "Can join games" switch, for a 16-17 who is
otherwise allowed to pay), host blocks (`enforce_host_block` covers join_requests and game_participants only,
20261028150000 L61-68), and the game's age range.

### 3c. The roster place (game_participants INSERT)

Written by the player's own client, or by the server with the service role after the host verifies
(`src/lib/payments.functions.ts:181-182, 236-237` → `src/lib/roster-on-payment.server.ts:4`).

- `enforce_game_join_gate` (20261103140000 L239-345): refuses cancelled or completed games for every writer. For
  non-host writers who are not approved it also refuses joins_closed and the signup cutoff. It refuses a full roster
  for everyone except the host and moderators. "Over by the clock" and the approval and fee requirements apply to a
  self-write only.
- `enforce_child_game_participation` (20261111160000): unknown age, `child_game_participation_allowed`, and the
  guardian's approval of a request for this game. Applies to every writer, including the service role.
- `enforce_game_age_requirement` (20260902001922): applies to every writer.
- `enforce_host_block`: a self-write only. The service role's add after a host verifies is not stopped (the host
  chose to verify).
- `addPaidPlayerToRoster` swallows a failed insert (`console.error`, `{ added: false }`). The callers also
  `.catch(() => {})`. The payment stays `verified` and nobody is told the place was not given.

### 3d. The risk acknowledgment

Client-only. `game_safety_acknowledgments` (20260901213929) is not read by any trigger or RPC on game_participants,
join_requests or payment_submissions. Nothing on the server requires it on any path, free, approval or paid.

## 4. Can someone end up paying, or joined, when they should not?

| Case                                                                                                               | Joined (rostered)?                                                                                                                               | Claim recorded?                               | Money moved?                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minor under 16, consent-locked account, or unknown age                                                             | No (roster gate; also never gets a payment claim)                                                                                                | No (cohort trigger)                           | PayPal: no. Manual: before this fix, possible. The handles and deep links were shown and the refusal came only on proof submission. Now blocked on /pay.                                                                                                              |
| 16-17 with a guardian link and no guardian approval for this game                                                  | No                                                                                                                                               | No (guardian_first)                           | PayPal: no. Manual: possible by external app before the refusal. The game page sends them to "Ask your parent" (guardianOnly), but a direct /pay visit is not gated on the client. Now blocked on /pay too (`guardian` kind, game_payment_guardian_ready; section 5). |
| 16-17 with "Can join games" off but a guardian-approved request                                                    | No (child_game_participation_allowed)                                                                                                            | **Yes** (no participation check on the claim) | PayPal: no. Manual: yes, money can move for a place that can never be given. Client now blocks on /pay. **Server gap.**                                                                                                                                               |
| Locked game (cancelled, ended, in progress, host-closed, past the cutoff), player not approved and not in the flow | No (join gate; in-progress by clock only for self-writes, but cutoff/closed for all non-approved)                                                | **Yes**                                       | PayPal: no. Manual: yes. Client now blocks on /pay. **Server gap (claim).**                                                                                                                                                                                           |
| Full game                                                                                                          | No (GAME_FULL for any non-host writer, even approved)                                                                                            | **Yes**                                       | PayPal: no. Manual: yes. The host may verify, the roster add fails silently, and the payment stays `verified`. Client: soft "just filled up" warning only (unchanged; see 6). **Server gap (claim, plus a silent roster failure).**                                   |
| Blocked by the host                                                                                                | Self-join: no. After the host verifies the payment: yes (the service role skips `enforce_host_block`; the host verified, which is their choice). | **Yes**                                       | PayPal: no. Manual: yes. The client cannot know (the block list is not readable by the blocked person, and should not be). **Server gap (claim).**                                                                                                                    |
| Outside the game's age range, not approved                                                                         | No (age trigger, every writer)                                                                                                                   | **Yes**                                       | PayPal: no. Manual: yes. **Server gap (claim).**                                                                                                                                                                                                                      |

So nobody gets a roster place the safety rules forbid. The one exception is host blocks, and there the host verifies
the payment themselves. What leaks is **manual payment claims, and the money that moves before them**, for games or
accounts that can never be given the place. On a manual payment the money moves in Venmo or Cash App before the app
ever writes anything, so the only safeguard before money moves is what the pay page shows.

## 5. The client fix (final behaviour)

Branch claude/pay-entry-gate, stacked on claude/e2e-chronic-failures at 85fcedf6. Commit
33fe78f8 added the first version; the first review round (changes needed) is addressed by the
commit that follows it (4f4f6fc0), and the next review (changes needed: a loading flash, the per-game
latch, the game page on cancelled/ended games, PayPal on an ended game, real getMyChildStatus coverage) by round 4,
the commit after that. No database change.

### 5a. The decision: `src/lib/pay-entry-gate.ts`

`payEntryView(...)` decides what the pay page may show before any payment option is drawn. It returns one of:

| View                      | When                                                                                                                                                                                                                                                                     | What the page shows                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking`                | the child-status policy (`useMyChildStatus`) or the guardian check (`game_payment_guardian_ready`) has not answered yet; or the viewer's own flow state (their request, their payments, the roster store) has not loaded and the only block is one that state could lift | "Loading payment options…". Never the handles, links, PayPal or proof form, and never "You can't pay" to a player who may be approved or on the roster.                                                                                                                                                                   |
| `check_failed`            | any of those failed before it ever answered (a later refresh failure keeps the last answer)                                                                                                                                                                              | "We couldn't check whether this account can pay for this game." with Retry (`data-testid="pay-entry-check-failed"`), which re-asks whatever failed. Never the handles.                                                                                                                                                    |
| `blocked`, mode `replace` | `payEntryBlock` answers a block (below)                                                                                                                                                                                                                                  | "You can't pay for this game" card (`data-testid="pay-entry-blocked"`, `data-block=<kind>`, `data-mode="replace"`) with the reason, "Don't send the host any money for it." and "Back to game", in place of PayPal, the handles and deep links, the proof form, the stepper and the "arrange payment with the host" card. |
| `blocked`, mode `warn`    | a block of a kind whose claim the database still records (`locked`, `participation`), for a viewer who already started paying and is on the proof step                                                                                                                   | the same card (`data-mode="warn"`) ABOVE the proof form: "Don't send the host any money for it. If you already paid, submit proof below so the host can see it and refund you."                                                                                                                                           |
| `clear`                   | nothing blocks                                                                                                                                                                                                                                                           | the page as before.                                                                                                                                                                                                                                                                                                       |

So the page now fails closed for minor safety: before, `can()` answered "allowed" while the child status loaded and,
permanently, when it errored.

**The viewer's flow state (round 4).** `holdsPlace` (useIsJoined), `paymentIn` (their submissions) and `approved`
(their request) only ever lift a block (a unit test checks this over every join state, participation and guardian
answer). `payEntryView` takes `flow: "loading" | "error" | "ready"`; until it is `ready` the three count as false
(fail closed: a stale "joined" saved in localStorage does not clear anyone), and a block they could lift (any `locked`
other than a cancelled game, and `participation`) becomes `checking`, or `check_failed` when a read failed. A
viewer with no block stays `clear`, and `payments`, `guardian` and a cancelled game show at once. Before this, an
approved player on an in-progress, host-closed or past-cutoff game, a rostered player on an ended game or one blocked
by participation was told "You can't pay for this game … Don't send the host any money" until their request landed,
and for 15+ s when getMyJoinRequest failed or timed out (it only logged a warning and waited for the poll).

`payEntryBlock(...)`, in order:

1. `payments`: `canChildFeature("game_payments")` not allowed (13-15, under 13, consent not approved, unknown age).
   Every viewer, because enforce_game_payment_cohort refuses every new claim. Message: "Add your date of birth…" for
   an unknown age, the consent reason, else PAYMENTS_BLOCKED_MESSAGE.
2. `locked`, cancelled or completed game (said before any parent rule, since asking a parent would not help):
   - `cancelled`: every viewer, including one on the roster, with a payment in or approved
     (enforce_game_join_gate refuses every writer; paypal_payment_precondition answers GAME_CANCELLED to every player).
   - `completed`: anyone who does not hold a place (GAME_COMPLETED); an approved viewer or one with a payment in is
     blocked too.
3. `participation`: `canChildFeature("game_participation")` not allowed, unless the viewer holds a place.
4. `guardian` (new): `game_payment_guardian_ready(gameId)` is false. Every viewer, as enforce_guardian_before_payment
   refuses every claim. Message: PAYMENTS_GUARDIAN_APPROVAL_MESSAGE ("Your parent needs to approve this game before
   you can pay. Go back to the game and ask them."). This closes the host-approved-but-guardian-pending case: the
   host's approval clears the approval card and makes the settings row (and so the handles) readable, while the
   guardian stamp is still null.
5. `locked`, in_progress / closed_by_host / closed_cutoff: a viewer not on the roster, with no payment in and not
   approved. These are the only lock states where the server lets an approved (or rostered) player through
   (enforce_game_join_gate for non-approved writers only; the PayPal precondition's GAME_JOINS_CLOSED skips approved
   players, and its "over by the clock" check skips rostered ones).

A full roster is still not decided here (the "just filled up" warning stays).

**Age range: not applied on the pay page.** It needs the viewer's exact age, i.e. a new read of their birthday
(`get_my_birthday`), which the task ruled out. In practice the only viewers who see handles are those who can read the
settings row (payee, approved requester, payer, participant: private_sec.can_read_game_payment_settings), and the
server's age rule exempts approved and rostered players; PayPal checks AGE_REQUIREMENT_NOT_MET itself. The remaining
case, a non-approved viewer with an earlier claim on an age-ranged game, stays a server gap (section 6).

### 5b. The pay page: `src/routes/games.$gameId.pay.tsx`

- Calls `game_payment_guardian_ready` through `useGamePaymentGuardianReady` (src/hooks/use-game-payment-guardian-ready.ts;
  react-query, keyed on the game, the viewer and the request's id/status/guardian stamp, so it asks again when the
  request changes; polls every 15s while the answer is false; keeps the previous answer for the same game and viewer
  while re-asking, never another viewer's). The function exists in 20261111100000 and is granted to `authenticated`
  only; it reads `auth.uid()`, so it answers for the caller.
- Order of the body: the block card (when `blockOutranksApproval`) → checking → check failed → "Waiting on host
  approval" → the block card (a lock the host's approval would lift, while the request is pending) → the usual
  loading / retry / empty / picker / proof. So a 13-15, a consent-locked account, a guardian block or a cancelled or
  ended game is said before "Payment unlocks after the host approves you"; a pending request on a host-closed, past-cutoff
  or in-progress game still gets the approval card (approval does unlock it).
- "Already started paying" (`paymentStarted`): latched when a method's proof step was on screen while nothing blocked
  the viewer (a picked method, including a single method the page preselected, once it was actually shown), or when
  the pay-opened sessionStorage marker (`pay-opened:<game>:<method>`, markExternalPaymentOpened) exists for one of the
  host's methods (survives a reload). A block that turns up afterwards (the signup cutoff passes, the host closes
  joining, the game is cancelled, a guardian turns games off) shows as the `warn` card above the proof form, so the
  claim can still be recorded and the host can refund. If the viewer leaves the proof step (Cancel), the picker would
  show the handles again, so the card replaces it. For `payments` and `guardian` the database refuses the claim, so the
  proof form would only fail: the card replaces it and says "If you already paid, message the host to ask for a refund."
- The status timeline (withdraw or dispute an existing claim) is unchanged and shows in every case.
- Round 4: the request and submissions reads run in their own effect, beside the settings and methods (they used to
  start only after both of those). Their state is kept per game and viewer (`viewerLookup`, keyed `game:viewer`): a
  read that fails with nothing loaded is `error`, a later poll that answers makes it `ready`. On a change of game the
  old game's request and payments are cleared, so they never stand in for the new game's (before, an approval on game
  A also skipped game B's approval card). `flow` is `ready` only when both reads and the roster store
  (`useRosterLoadState`, new in src/lib/games-store.ts: `loading` until the viewer's places were read from the
  database, `error` if that first read failed, `retryRosterLoad()` re-reads) have answered.
- Round 4: the "Waiting on host approval" card also waits for the request read, since its wording ("Send a request to
  join first") rests on it.
- Round 4: the `paymentStarted` latch is held per game (`paymentStartedFor === gameId`). The route component stays
  mounted from /games/A/pay to /games/B/pay, and a latch from A with B's preselected single method would have turned
  B's block into a warning above B's handles and proof form.
- Round 4: PayPal is not offered on an ended or cancelled game (`payPalOffered(joinState)`): paypal_payment_precondition
  answers GAME_COMPLETED / GAME_CANCELLED to every player, rostered or not. A rostered player who still owes for an
  ended game keeps the host's manual methods; with no manual method they get the "message the host" card.

### 5c. The game page: `src/routes/games.$gameId.index.tsx`

`paymentAction` is now `payHostLinkShown({...})` (src/lib/pay-entry-gate.ts), which adds `!lockedForNewJoin &&
!consentBlocksNewJoin` to the old conditions. A locked or consent-blocked new viewer falls through to the existing
disabled button ("Signup closed", "In progress", "Game ended", "Parent approval needed"); joined, pending, confirmed and
approved viewers keep their Pay link (lockedForNewJoin exempts them). Round 4: `gameTakesNoPayment(joinState,
holdsPlace)` (a cancelled game, or an ended one without a place, as payEntryBlock decides) hides the link too, and an
approval no longer exempts such a viewer from `lockedForNewJoin`, so an approved, unpaid player gets the disabled
"Cancelled" (new label) or "Game ended" button instead of a link to a page that only says they cannot pay. A pending
payment keeps its "Payment pending · View status" link: the pay page shows that payment's timeline (withdraw,
dispute), and the button's tap would open the same page. The risk acknowledgment was NOT added to the paid
path (owner decision pending, section 7). No payments-permission check was added to the link (a 13-15 still gets the
link and then the pay page's block card, as guardedOpenJoin intends).

### 5d. Tests

- `src/lib/pay-entry-gate.test.ts`: 43 tests in round 3, 61 in round 4 (the flow-state cases, including "approved not
  yet known on closed_by_host → checking"; the "flow only lifts a block" property; gameTakesNoPayment; payPalOffered;
  payHostLinkShown on cancelled, ended and in-flow lock states). `src/lib/games-store.test.tsx`: 4 new tests for
  useRosterLoadState / retryRosterLoad. Each join state through the real `resolveJoinGate` (cancelled blocks
  every viewer incl. holdsPlace/paymentIn/approved; completed blocks all but holdsPlace; in_progress / closed_by_host /
  closed_cutoff block a new viewer and exempt each in-flow case; open), the guardian kind (host-approved but
  guardian-pending; applies to in-flow viewers; cancelled said first), fail-closed (loading and error for each check),
  the warn/replace decision (locked, cancelled, participation warn; payments/guardian replace; no method on screen
  replaces; not started replaces), blockOutranksApproval, and payHostLinkShown.
- `e2e/pay-entry-blocked.spec.ts` (mocked, data-independent: game row, settings, two methods (Venmo, Cash App), request,
  payments, place, guardian RPC, PayPal config and a stand-in PayPal SDK so a PayPal button WOULD render if offered):
  (a) host-closed paid game, fresh viewer → block card, no Venmo/Cash App link or handle, no PayPal, no proof form;
  (b) cancelled game, approved viewer → block card, no approval card, nothing payable; (c) host-closed game, approved
  viewer → Venmo and Cash App links and the PayPal section, no block card. Round 4: (c) holds the join_requests
  response until the child status and guardian check have answered, asserts "Loading payment options…" and no block
  card while it is held, then releases it; a MutationObserver checks the block card was never drawn. (c) also asks the
  real getMyChildStatus server function (not the restoreSession stub) and asserts it answers 200 with the adult cohort.
- `e2e/helpers/signed-in.ts`: `answerSessionChecks` also answers `getMyChildStatus` for the fixture adult
  (ADULT_CHILD_STATUS), like the getMyAgeStatus stub beside it, so the pay page's fail-closed wait does not depend on a
  slow sandbox server function. A spec walking a minor's flow can stub it again after (newest route wins). Since the
  pay page offers nothing until getMyChildStatus answers, pay-entry-blocked (c) routes it to the real server function
  (`route.continue()` ahead of the stub), so a regression that makes it fail or hang fails E2E.

### What is left on the client

- The pay page does not apply the game's age range (above).
- A full roster stays a soft warning.
- /pay still reads `requires_approval` and the methods from the settings row a new viewer cannot read (6c).
- Game page, edge case not changed: a viewer on the roster of a cancelled paid game whose payment was never verified
  (e.g. added by the host) still gets the "Pay Host" button; its tap opens the pay page, which shows the block card.
- An 18+ viewer with a leftover active guardian link: the client follows game_payment_guardian_ready and shows the
  handles, but the manual-claim trigger still refuses their proof (server gap 6d).

## 6. Server gaps: proposed migration outline (NOT applied; needs owner approval)

`supabase/migrations/2026111XXXXXXX_payment_claim_preconditions.sql`

1. A new BEFORE INSERT trigger on `public.payment_submissions`, `enforce_payment_claim_preconditions()`, SECURITY
   DEFINER, `search_path = ''`. It runs only when `auth.uid() IS NOT NULL AND auth.uid() = NEW.player_id` (the
   player's own claim). Host "Marked paid by host" inserts (`host_id = auth.uid()`) and the service role's PayPal
   record are left alone. PayPal already asked before the money moved, and refusing the record of a captured payment
   is worse.
2. The rules for a player not yet on the roster (`NOT public.is_game_participant(game, player)`), mirroring
   `private_sec.paypal_payment_block`:
   - cancelled or completed game → `GAME_CANCELLED` / `GAME_COMPLETED`;
   - over by the clock → `GAME_COMPLETED`;
   - not approved and (joins_closed or past the signup cutoff) → `GAME_JOINS_CLOSED`;
   - roster count ≥ max_players → `GAME_FULL` (owner decision: this changes today's soft warning into a refusal);
   - `NOT public.child_game_participation_allowed(player)` → `GAME_PARTICIPATION_BLOCKED` (any player, on the roster
     or not);
   - host blocked the player → `BLOCKED_BY_HOST` (the one-directional rule of `enforce_host_block`);
   - age range not met and not approved → `AGE_REQUIREMENT_NOT_MET`.
     Simplest: factor the shared part of `paypal_payment_block` into `private_sec.payment_claim_block(_game, _player)`
     and call it from both. Keep the PayPal-only codes (PAYMENT_IN_PROGRESS, ALREADY_PAID) in the PayPal function.
3. Only on INSERT. Existing claims can still be withdrawn, disputed or rejected. Rows already written are untouched.
4. App: map the new codes in `paymentSubmissionErrorMessage` (src/lib/payments-policy.ts:43) to the existing
   PAYMENT_PRECONDITION_MESSAGES wording, without "You weren't charged." (on a manual claim the money may already have
   moved).
5. Separately: `addPaidPlayerToRoster` failures should not be silent. When the place cannot be given, notify the host
   and the player ("refund owed" or a payment alert), so the verified-but-not-placed state is visible.
6. Rollback file in docs/rollbacks, guarded as the others are. Apply to the sandbox first, never directly to
   production.

Also related, not fixed:

- (d) **Guardian rule, adult exemption: the RPC and the trigger disagree.** `public.game_payment_guardian_ready(game)`
  (20261111100000 §3) exempts a viewer known to be 18 or over (a stored birthday, `age(birthday) >= 18`) even when a
  guardian link made before 18 is still `active`. `enforce_guardian_before_payment`, the BEFORE INSERT trigger on
  `payment_submissions` that checks a manual (Venmo, Cash App…) claim, calls
  `private_sec.guardian_payment_approval_missing(player, game)` with no such exemption (the 20261111100000 header says
  so: "The payment trigger has no such exemption for a manual payment; that is unchanged here"; 20261111140000 and
  20261111160000 do not change it). For that viewer the pay page asks the RPC, gets `true`, and shows the host's
  handles; after they pay in Venmo, the database refuses their proof with GUARDIAN_APPROVAL_REQUIRED, so the host
  never sees the claim. PayPal is consistent (paypal_payment_precondition asks the RPC). Proposed fix (owner
  approval, sandbox first): give the trigger the same adult exemption, ideally by moving it into
  `guardian_payment_approval_missing` so the RPC, the trigger and PayPal share one rule; or end guardian links when
  the child turns 18. No client change is needed once the trigger matches; until then the client cannot see the
  difference (the RPC is its only view of the rule).
- (a) `get_game_host_payment_methods` (20261111120000 §2) returns the host's handles to any caller who can see the
  game, including a 13-15 who may not pay. The handles are an adult's (adult payee only), so this is a minor-safety
  question rather than a privacy leak. It could add `public.game_payments_allowed(auth.uid())`.
- (b) Done in the client (section 5): /pay calls `game_payment_guardian_ready(game)` and blocks with the `guardian`
  kind, failing closed while it has not answered.
- (c) The pay page reads `requires_approval` from the settings row (L478 base). A prospective viewer cannot read
  that row (can_read_game_payment_settings: payee, approved requester, payer or participant only, 20261103140000
  L57-70), so for a fresh viewer `settings` is null: `requiresApproval` reads false and the methods list is empty.
  Derived from the policies (not reproduced live): a fresh player on a paid **open** game who taps "Pay Host" lands
  on "Host hasn't set up payment yet. Message the host directly to arrange payment." (no handles, no PayPal: both
  need `settings`). The E2E specs mock the settings row, so they do not see this. Worth its own task: give /pay the
  public join policy (useGameJoinPolicy, as the game page does) and a payee-scoped way to read the methods and
  PayPal config for a viewer who passes payEntryBlock.

## 7. Product decision: should paid joins show "Before you join"?

Today: free joins and request-to-join show it (handleJoin). A paid open game never shows it. A paid approval game
shows it at request time only. Nothing on the server requires it anywhere.

- **Option A: show it on the paid path (client).** Game page: in the `paymentAction` branch, give the Link an
  onClick that, when `needsRiskAcknowledgment({signedIn, isHost, alreadyJoined: viewerCountsAsJoined || isPending,
acknowledgedVersion: riskAckVersion})` is true, calls `e.preventDefault(); void handleJoin();`. `confirmRiskAck` →
  `executeJoinAction` already routes a paid, approval-cleared viewer to /pay (L1016-1022), so no new navigation code
  is needed. Pay page: for a direct visit, read `useSafetyAck(gameId, "participant_risk")` and show the same
  RiskAcknowledgment dialog (or a block card) before the payment options, for viewers not in the flow (reuse
  payEntryBlock's exemptions). Tests: a unit test for the predicate. E2E: the four pay-and-join specs
  (invite-pay-and-join, -confirmation, -verified, invite-deeplink-to-pay) would then need `stubRiskAcknowledged` or
  to click through the dialog, plus one spec that goes through it on a paid game. About half a day.
- **Option B: show it on the pay page only.** One place covers both entries (Link and direct visit). The ack is
  written before the payment options appear. Slightly later in the flow than on free games. About the same effort
  without the game-page change. The specs would still need the stub.
- **Option C: enforce it on the server** (on top of A or B). A BEFORE INSERT check on payment_submissions (player
  claim) and game_participants (self-write) that requires a current-version `participant_risk` row. The version
  constant lives in the app (SAFETY_ACK_VERSION, src/lib/safety.ts), so the database would need the current version
  (a settings row or function). Any client that skips the dialog would then fail. Larger, and needs a migration and
  owner approval.
- **Option D: keep today's behaviour** and record that paying is not gated by the acknowledgment. The pay page
  already shows PaymentSafetyNotice and the refund terms. Document the decision in the spec comment
  (e2e/invite-pay-and-join.spec.ts) so the spec's lack of a risk-ack step is intended.

## 8. Verification

- Round 1 (33fe78f8): `npx vitest run src/lib/pay-entry-gate.test.ts src/lib/spots-urgency.test.ts src/lib/child-policy.test.ts src/lib/guarded-open-join.test.ts`: 4 files, 99 tests passed; pay-entry-gate.test.ts had 12 then (43 in round 3, 61 in round 4).
- `npx tsc --noEmit -p .`: exit 0. `LINT_BASE=origin/main node scripts/lint-changed.mjs`: no file adds ESLint errors. The pay page's 4 existing errors are unchanged: 3 `any` and max-lines.
- E2E (local stack, run-e2e.sh): all 24 spec files that visit /pay, 71 tests: **71 passed** (6.0 min). The specs were
  pay-submission-confirmation, fixture-age-gated-flows, pay-submission-declined, invite-deeplink-join-cta,
  invite-pay-and-join-verified, pay-cta-reaches-success-or-retry, invite-expired, pay-screen-no-cross-host-leak,
  pay-button-navigates, pay-approval-polling-fallback, pay-approval-realtime-only, invite-pay-and-join-confirmation,
  invite-malformed-exp, pay-rejected-confirmation, pay-realtime-delayed-polling-no-duplicates,
  pay-verified-confirmation, responsive-overflow, invite-deeplink-to-pay, pay-only-after-approval-no-duplicates,
  leave-verified-payment-consistency, pay-approval-gate-flips, invite-pay-and-join, pay-blocked-until-approved and
  pay-screen-rpc-and-empty-state.
- Round 1 had no E2E spec for the block card; round 3 added e2e/pay-entry-blocked.spec.ts (section 5d), which
  drives it.

### Round 3 (4f4f6fc0, branch claude/pay-entry-gate)

- `npx vitest run` pay-entry-gate, spots-urgency, child-policy, guarded-open-join, payments-policy,
  use-paypal-checkout-config: 6 files, 142 passed (pay-entry-gate: 43). Plus 11 other files touching the changed
  modules: 138 passed.
- `npx tsc --noEmit -p .`: clean. `LINT_BASE=origin/main node scripts/lint-changed.mjs`: none adds ESLint errors.
- E2E, local stack via run-e2e.sh: e2e/pay-entry-blocked.spec.ts 3 passed (logs/paygate-r3-new.log); all
  e2e/pay-_.spec.ts and e2e/invite-pay-and-join_.spec.ts (19 files, 28 tests): 28 passed, 0 failed, 0 skipped
  (logs/paygate-r3-pay.log).
- Mutation check: with the old cancelled-game exemption put back, the cancelled/approved E2E test fails (card never
  appears; logs/paygate-r3-mutant.log), so the spec does detect the bug it covers.

### Round 4 (7de84011, branch claude/pay-entry-gate)

- `npx vitest run src/lib/pay-entry-gate.test.ts`: 61 passed. `src/lib/games-store.test.tsx`: 18 passed (4 new).
  `npx vitest related --run` on the four changed source files: 8 files, 104 passed, 1 skipped (already skipped before).
- `npx tsc --noEmit -p .`: clean. `LINT_BASE=origin/main node scripts/lint-changed.mjs`: none adds ESLint errors.
- E2E, local stack via run-e2e.sh: e2e/pay-entry-blocked.spec.ts 3 passed (e2e-peb.log). All e2e/pay-_.spec.ts,
  e2e/invite-pay-and-join_.spec.ts and e2e/risk-ack-before-join.spec.ts (20 files, 29 tests): **29 passed**, 0 failed,
  0 skipped, 0 flaky (2.7 min, e2e-r4-all.log).
- Mutation check: with `flow` forced to `"ready"` on the pay page (the round-3 behaviour), pay-entry-blocked (c) fails:
  "Loading payment options…" never shows while the request is held, because the block card is drawn instead.
