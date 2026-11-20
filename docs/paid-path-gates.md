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

NOT checked on the claim (before 20261119200000; now checked, see section 6): the game's join gate (cancelled,
completed, over by the clock, joins_closed, signup cutoff), capacity, `child_game_participation_allowed` (a guardian's
"Can join games" switch, for a 16-17 who is otherwise allowed to pay), host blocks (`enforce_host_block` covers
join_requests and game_participants only, 20261028150000 L61-68), and the game's age range.

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
  (Fixed on branch claude/payment-claim-preconditions: the host and the player are both notified; section 6, item 5.)

### 3d. The risk acknowledgment

Client-only. `game_safety_acknowledgments` (20260901213929) is not read by any trigger or RPC on game_participants,
join_requests or payment_submissions. Nothing on the server requires it on any path, free, approval or paid.

## 4. Can someone end up paying, or joined, when they should not?

| Case                                                                                                               | Joined (rostered)?                                                                                                                               | Claim recorded?                               | Money moved?                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minor under 16, consent-locked account, or unknown age                                                             | No (roster gate; also never gets a payment claim)                                                                                                | No (cohort trigger)                           | PayPal: no. Manual: before this fix, possible. The handles and deep links were shown and the refusal came only on proof submission. Now blocked on /pay.                                                                                                                   |
| 16-17 with a guardian link and no guardian approval for this game                                                  | No                                                                                                                                               | No (guardian_first)                           | PayPal: no. Manual: possible by external app before the refusal. The game page sends them to "Ask your parent" (guardianOnly), but a direct /pay visit is not gated on the client. Now blocked on /pay too (`guardian` kind, game_payment_guardian_ready; section 5).      |
| 16-17 with "Can join games" off but a guardian-approved request                                                    | No (child_game_participation_allowed)                                                                                                            | **Yes** (no participation check on the claim) | PayPal: no. Manual: yes, money can move for a place that can never be given. Client now blocks on /pay. **Server gap.**                                                                                                                                                    |
| Locked game (cancelled, ended, in progress, host-closed, past the cutoff), player not approved and not in the flow | No (join gate; in-progress by clock only for self-writes, but cutoff/closed for all non-approved)                                                | **Yes**                                       | PayPal: no. Manual: yes. Client now blocks on /pay. **Server gap (claim).**                                                                                                                                                                                                |
| Full game                                                                                                          | No (GAME_FULL for any non-host writer, even approved)                                                                                            | **Yes**                                       | PayPal: no. Manual: yes. The host may verify, the roster add fails silently, and the payment stays `verified`. Client: soft "just filled up" warning only (since 2026-11-20 the `full` block, 6 "Also related" (e)). **Server gap (claim, plus a silent roster failure).** |
| Blocked by the host                                                                                                | Self-join: no. After the host verifies the payment: yes (the service role skips `enforce_host_block`; the host verified, which is their choice). | **Yes**                                       | PayPal: no. Manual: yes. The client cannot know (the block list is not readable by the blocked person, and should not be). **Server gap (claim).**                                                                                                                         |
| Outside the game's age range, not approved                                                                         | No (age trigger, every writer)                                                                                                                   | **Yes**                                       | PayPal: no. Manual: yes. **Server gap (claim).**                                                                                                                                                                                                                           |

So nobody gets a roster place the safety rules forbid. The one exception is host blocks, and there the host verifies
the payment themselves. What leaks is **manual payment claims, and the money that moves before them**, for games or
accounts that can never be given the place. On a manual payment the money moves in Venmo or Cash App before the app
ever writes anything, so the only safeguard before money moves is what the pay page shows.

Since 20261119200000 (section 6) every "Claim recorded? **Yes**" row above is refused when the player writes the claim,
with PayPal's code for the same rule. The money in those rows can still move first (the claim comes after the payment
in Venmo or Cash App); what changed is that the host is never asked to verify, and the player is told why, instead of
a claim for a place that can never be given.

## 5. The client fix (final behaviour)

Branch claude/pay-entry-gate, stacked on claude/e2e-chronic-failures at 85fcedf6. Commit
33fe78f8 added the first version; the first review round (changes needed) is addressed by the
commit that follows it (4f4f6fc0), and the next review (changes needed: a loading flash, the per-game
latch, the game page on cancelled/ended games, PayPal on an ended game, real getMyChildStatus coverage) by round 4,
the commit after that. No database change.

### 5a. The decision: `src/lib/pay-entry-gate.ts`

`payEntryView(...)` decides what the pay page may show before any payment option is drawn. It returns one of:

| View           | When                                                                                                                                                                                                                                                                     | What the page shows                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking`     | the child-status policy (`useMyChildStatus`) or the guardian check (`game_payment_guardian_ready`) has not answered yet; or the viewer's own flow state (their request, their payments, the roster store) has not loaded and the only block is one that state could lift | "Loading payment options…". Never the handles, links, PayPal or proof form, and never "You can't pay" to a player who may be approved or on the roster.                                                                                                                                                                                                                                                        |
| `check_failed` | any of those failed before it ever answered (a later refresh failure keeps the last answer)                                                                                                                                                                              | "We couldn't check whether this account can pay for this game." with Retry (`data-testid="pay-entry-check-failed"`), which re-asks whatever failed. Never the handles.                                                                                                                                                                                                                                         |
| `blocked`      | `payEntryBlock` answers a block (below)                                                                                                                                                                                                                                  | "You can't pay for this game" card (`data-testid="pay-entry-blocked"`, `data-block=<kind>`) with the reason, "Don't send the host any money for it." (plus "If you already paid, message the host to ask for a refund." for a viewer who already started paying) and "Back to game", in place of PayPal, the handles and deep links, the proof form, the stepper and the "arrange payment with the host" card. |
| `clear`        | nothing blocks                                                                                                                                                                                                                                                           | the page as before.                                                                                                                                                                                                                                                                                                                                                                                            |

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
6. `age` (round 5): the game's age range, for a viewer who is not the host and not in the flow, whose age is outside
   it or unknown (no birthday on file). Same wording as the game page (ageGateMessage). See 5e.

7. `full` (owner decision 2026-11-20, section 6 "Also related" (e)): the roster holds as many players as the game
   takes, for a viewer not on it who is not the host. Asked after the lock and before the age range.

A full roster was a soft "just filled up" warning until 2026-11-20; it is now the `full` block (item 7).

**Age range: applied on the pay page since round 5 (owner decision 2026-11-18, #430 question 4).** Before, it was
not, because it needs the viewer's exact age (a read of their birthday, `get_my_birthday`). The decision asks for
the game page's own source and rule, which is that read (`useMyAge`). See section 5e.

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
  joining, the game is cancelled, a guardian turns games off) replaces the payment options and the proof form, and
  the card says "If you already paid, message the host to ask for a refund." Until 20261119200000 a `locked` or
  `participation` block showed instead as a `warn` card above the proof form ("submit proof below so the host can see
  it and refund you"), because nothing on `payment_submissions` checked the join gate or participation then. Since that
  migration's trigger refuses exactly those claims (GAME_CANCELLED, GAME_COMPLETED, GAME_JOINS_CLOSED,
  GAME_PARTICIPATION_BLOCKED), the proof form could only fail, so the `warn` mode was removed (section 6, review
  round).
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
  B's block into a warning above B's handles and proof form (now: told B's viewer to ask for a refund).
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
dispute), and the button's tap would open the same page. The risk acknowledgment was not added to the game page's paid
link; since round 5 the pay page asks it (section 7, Option B). No payments-permission check was added to the link (a 13-15 still gets the
link and then the pay page's block card, as guardedOpenJoin intends).

### 5d. Tests

- `src/lib/pay-entry-gate.test.ts`: 43 tests in round 3, 61 in round 4 (the flow-state cases, including "approved not
  yet known on closed_by_host → checking"; the "flow only lifts a block" property; gameTakesNoPayment; payPalOffered;
  payHostLinkShown on cancelled, ended and in-flow lock states). `src/lib/games-store.test.tsx`: 4 new tests for
  useRosterLoadState / retryRosterLoad. Each join state through the real `resolveJoinGate` (cancelled blocks
  every viewer incl. holdsPlace/paymentIn/approved; completed blocks all but holdsPlace; in_progress / closed_by_host /
  closed_cutoff block a new viewer and exempt each in-flow case; open), the guardian kind (host-approved but
  guardian-pending; applies to in-flow viewers; cancelled said first), fail-closed (loading and error for each check),
  the already-started cases (one block card and the refund advice for every kind, since 20261119200000 removed the
  `warn` mode), blockOutranksApproval, and payHostLinkShown.
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

### 5e. Round 5 (branch claude/pay-risk-ack-age, owner decisions 2026-11-18)

- **"Before you join" on the pay page (section 7, Option B).** `payRiskAckView` (src/lib/pay-entry-gate.ts) decides
  it with the join tap's own rules (`needsRiskAcknowledgment`, `planRiskAckTap`): `none` for the host, for a viewer
  in the flow (on the roster, a payment in, or approved: payEntryBlock's exemptions) and once the current version is
  on file; `checking` while the acknowledgment read has not answered, or while the viewer's flow state is still
  loading for a viewer it would ask (the "Loading payment options…" card, never the options); `ask` otherwise,
  including a failed read (fail closed, as src/lib/risk-ack-tap.ts does) and a flow state that failed to load. The
  pay page draws the existing `RiskAcknowledgmentDialog` in place of the payment options, after any block card,
  pending check or approval card, and only once the host's payment settings have answered (`payRiskAckStep`: `held`
  until then, so the settings' "Loading payment options…" or "Couldn't reach the payment service" card shows; the
  settings' `requires_approval` decides whether the approval card comes first, and the dialog used to open, then
  close by itself when it arrived). Agreeing calls `recordSafetyAck({ gameId, kind: "participant_risk" })` (the join
  path's write: same table, kind, version `SAFETY_ACK_VERSION` and idempotent upsert), then writes the current version
  into useSafetyAck's cache (`safetyAckQueryKey`) and re-reads in the background, so a failing re-read cannot keep the
  dialog open over a recorded acknowledgment (the join path carries on after its write too); the options then show.
  A failed write keeps the dialog and shows a toast. Cancel leaves a "Before you join" card (`data-testid="pay-risk-ack-required"`) with no payment options,
  "Review and agree" (opens the dialog again) and "Back to game". The stepper and the "already started paying" latch
  wait for it too.
- **Age range on the pay page (#430 question 4).** The game page's source and rule: `useMyAge()` (get_my_birthday)
  and `ageGateState` / `ageGateMessage` (src/lib/game-age.ts). No age-only source covers the viewer's own exact age
  (`my_platform_status` gives the cohort only; `profile_ages` hides an age whose profile is private), so the pay page
  reads it as the game page does. New block kind `age`, said after every other block, for a viewer who is not the
  host and not in the flow, when their age is outside the range or no birthday is on file. Wording as on the game
  page ("This game is 18+ — the host reviews requests outside that range." / "This game is 18+. Add your birthday to
  your profile, or request the host's approval."). Approved, rostered and paid-in viewers are exempt, matching the
  server's age rule (enforce_game_age_requirement and AGE_REQUIREMENT_NOT_MET skip approved and rostered players). It
  is only asked on a game with a range: until the age has loaded the range counts as not met, so a viewer it could
  block sees `checking`, and a failed read (useMyAge now reports `error` and can `retry`) sees `check_failed`, not
  "Add your birthday". A pending request gets "Waiting on host approval", not the age card, whether or not the host's
  settings require approval: `blockOutranksApproval` puts the approval card first, and `payAwaitsApproval` raises it
  on an open game too, as the game page's `requiresApproval` does for a viewer outside the range (the host's approval
  lifts the age rule). With no request, or a declined one, the age card stays. useMyAge's answer belongs to the
  account signed in now: it reads again, and is `loading` meanwhile, when the account changes without a remount. A viewer who already started paying gets the `warn` card above the proof form: the claim is still recorded
  (no age check on payment_submissions, section 6).
- **Game page, cancelled games.** `PaymentRequiredBanner` takes `takesPayment = !gameTakesNoPayment(joinState,
holdsPlace)` and draws nothing on a cancelled game, or an ended one for a viewer without a place (it used to say
  "Pay $X now"). A player on the roster of a cancelled paid game whose payment was never verified no longer gets
  "Pay Host": `unpaidOnGameTakingNoPayment` puts them under `lockedForNewJoin`, so the button is the disabled
  "Cancelled". A pending request or payment keeps its cancel/withdraw button; a confirmed player keeps "Tap to leave".
- **Booking sheet (#428 owner question).** `BookPrefill.venue` and its producers (TrainerActions' `defaultVenue`, the
  trainer profile's slot pick and "Book session") are removed: the sheet has no venue field. No behaviour change.

### What is left on the client

- A full roster: done on branch claude/pay-fresh-viewer-methods (section 6 "Also related" (e)): the pay page blocks
  a full game before showing any handle, as the database's GAME_FULL does.
- /pay reading `requires_approval` and the methods from the settings row a new viewer cannot read: done on branch
  claude/pay-fresh-viewer-methods (section 6 "Also related" (c)).
- An 18+ viewer with a leftover active guardian link: done on branch claude/guardian-adult-manual-claim (section 6
  (d)): the pay page asks the manual-claim rule itself and holds back the manual methods (PayPal kept).

## 6. Server gaps: payment claim preconditions (IMPLEMENTED, branch claude/payment-claim-preconditions)

**Owner decision, 2026-11-18: "approve all".** Items 1-6 of the outline below, including GAME_FULL as a refusal (it
replaces the pay page's soft "just filled up" warning on the server), and "Also related" (a). Item (d) is **not**
changed: it would loosen a guardian rule and stays a separate owner question (decided later the same day: block up
front, rule unchanged; see (d) below). (c) was checked, not changed (below).
Section 7 (the risk acknowledgment on paid joins) offers alternatives (A-D) and is not built on this branch.

### What was built

| Outline item                                  | Where                                                                                                                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-3. Claim trigger, shared rules, INSERT only | `supabase/migrations/20261119200000_payment_claim_preconditions.sql`                                                                                                                                                                                 |
| SQL tests                                     | `supabase/tests/900_payment_claim_preconditions.test.sql` (100 assertions); `762_paypal_payment_preconditions` unchanged and passing                                                                                                                 |
| 4. App messages                               | `src/lib/payments-policy.ts` (`PAYMENT_CLAIM_REFUSAL_CODES`, `paymentClaimRefusalMessage`, `paymentSubmissionErrorMessage`); tests in `src/lib/payments-submission.test.ts`                                                                          |
| 5. Verified but not placed                    | `src/lib/roster-on-payment.server.ts`, `src/lib/payments.functions.ts`, `src/lib/paypal.functions.ts`, `src/components/game-detail/RosterPlayerRow.tsx`, `src/components/GamePaymentsPanel.tsx`; tests in `src/lib/roster-on-payment.server.test.ts` |
| 6. Rollback                                   | `docs/rollbacks/20261119200000_payment_claim_preconditions.down.sql` (guarded: confirmation setting plus the md5 of all four functions; rehearsed)                                                                                                   |
| (a) Handles only for a caller who may pay     | same migration, `public.get_game_host_payment_methods`                                                                                                                                                                                               |

- `private_sec.payment_claim_block(game, player)` holds the shared rules in `paypal_payment_block`'s order:
  GAME_CANCELLED, GAME_COMPLETED, GAME_PARTICIPATION_BLOCKED, BLOCKED_BY_HOST for any player; for a player not on the
  roster AGE_REQUIREMENT_NOT_MET (not approved), GAME_COMPLETED by the clock, GAME_JOINS_CLOSED (not approved),
  GAME_FULL. It names a player, so no API role may call it (only the definer functions below).
- `private_sec.paypal_payment_block` now asks it instead of repeating those rules, and returns its codes at the same
  points as before (its own cancelled/completed check first, GAME_PARTICIPATION_BLOCKED / BLOCKED_BY_HOST where they
  were, the place rules last), so PayPal's answers are unchanged in value and order. PayPal-only codes stay in it.
  Proof: 762 passes unchanged; a differential run with the old function installed beside the new one gave identical
  answers for 9 people x 10 games at 15 points of the 900 scenario (1,350 comparisons).
- Trigger `zz_payment_claim_preconditions` (BEFORE INSERT on `payment_submissions`, named to fire after every other
  BEFORE INSERT trigger so their refusals keep their messages) runs `public.enforce_payment_claim_preconditions()`
  only when `auth.uid() = NEW.player_id`. Host "Marked paid by host" rows and the service role's PayPal record are not
  checked. The error is `CODE: sentence` (P0001), like the other payment triggers.
- `get_game_host_payment_methods` returns nothing to a caller for whom `game_payments_allowed(auth.uid())` is false,
  except the payee viewing their own handles. An adult guardian and a 16-17 who may pay still see them. It now pins
  `search_path = ''` (every name in it was already qualified).
- App: the new codes read as PayPal's sentence without "You weren't charged.", followed by "If you already sent the
  host money, message them to ask for it back." (e.g. "This game is full. If you already sent the host money, message
  them to ask for it back."): the refused claim writes no row, so the host is not told and the player needs the next
  step. Only a whole code at the start of the message counts.
- Item 5: `addPaidPlayerToRoster` returns why a verified payment gave no place (`cancelled`, `approval_required`,
  `refused` + the join gate's code, `already_on_roster`, `game_missing`). For the first three it writes a
  `payment_not_placed` notification (Payment updates category) to the host and to the player, with the reason and
  the next step (give the place, or send the money back). Only the game's own state is named (full, ended, joining
  closed, cancelled); a rule about the player (age range, guardian setting, block) reads as "the game's joining rules
  don't allow it". A player already on the roster is `already_on_roster` (checked before the approval rule, so a
  player the host added, or who joined before approval was switched on, is not reported as unplaced). The result
  says whether the notices were written (`noticeSent`). `reviewPaymentAction` returns `placed` (`placedAfterVerify`):
  true when the player holds the place, false only when both notices were written, else null. When it is false the
  host's roster row and payments panel show a warning ("We've sent you both a notice…") instead of "Payment
  verified." and do not send the player "You're all set"; on null (game gone, notice not written) they say and send
  what they do for any verified payment. No new server path or migration was needed.

### Found while building it

- **A host cannot "mark paid" a player with no claim.** `reviewPaymentAction` inserts that row with the host's own
  client, and `payment_submissions` has no INSERT policy for a host (only "Players create own submissions",
  `player_id = auth.uid()`), so the insert is refused by row level security today, with or without this migration.
  The 900 test checks the trigger's host exemption with RLS out of the way and says so. Not changed here.
- On a manual claim the money still moves before the database can refuse (the claim follows the payment). The pay
  page's own blocks (payEntryBlock, section 5) are what stop it first; GAME_FULL is one of them since 2026-11-20
  ("Also related" (e)).
- The pay page blocks a game in progress for a new viewer (as the game page does), but the trigger lets that claim
  through when the game has no signup cutoff and joining is open (enforce_game_join_gate does the same for the roster
  place). Every other lock and the participation block are refused by the trigger, which is why the pay page's `warn`
  mode was removed (section 5b).

### (c) checked on the local stack (not changed)

Confirmed live on the local E2E stack (2026-11-18, with 20261119200000 applied). Setup: a new adult host with a
Venmo handle, a public paid game (fee 12, 10 places, nobody on the roster) and its settings row with
`requires_approval = false`; the viewer is the E2E fixture player (adult, date of birth on file, not on the roster, no
join request, no payment). No mocks.

- As that player, `select from game_payment_settings where game_id = ...` returns `[]` (HTTP 200): RLS hides the row
  (`can_read_game_payment_settings` is false for a viewer who is not the payee, an approved requester, a payer or a
  participant). The same in SQL as `authenticated`: the game is visible (1 row), settings rows 0.
- /games/<id>/pay makes exactly that request (twice), gets `[]`, sets `settings` to null, never calls
  `get_game_host_payment_methods` (it is only called when `settings` is non-null, `src/routes/games.$gameId.pay.tsx`
  around L291-300), and renders "Host hasn't set up payment yet. Message the host directly to arrange payment." No
  handle and no PayPal button.
- The same player's token calling `get_game_host_payment_methods(host, game)` directly gets the Venmo handle (HTTP 200,
  one row). In the SQL check (a second fresh adult player, rolled back) the RPC also returns the handle and
  `paypal_payment_precondition` is NULL (may pay). So the server would let this player see the handles and pay; only
  the pay page's read of the settings row hides them.

So yes: a fresh signed-in player on a paid open game sees no handles. RLS was not changed. The fix belongs on the
client (ask the RPC for the methods, and the public join policy for `requires_approval`, instead of the settings
row), as proposed in (c) below. Built on branch claude/pay-fresh-viewer-methods (owner decision 2026-11-20); see (c).

### The outline as approved

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

Also related (as proposed; status: (a) done, (b) done earlier, (c) checked live, then fixed on the client on branch
claude/pay-fresh-viewer-methods, RLS unchanged, (d) blocked up front on branch claude/guardian-adult-manual-claim,
guardian rule unchanged, (e) a full game blocked on the pay page on branch claude/pay-fresh-viewer-methods):

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

  **Owner decision 2026-11-18: block up front; the guardian rule is not loosened.** The trigger keeps refusing that
  adult's manual claim. The pay page instead stops offering a manual method it knows the database will refuse.
  Built on branch claude/guardian-adult-manual-claim:

  - `public.game_manual_claim_guardian_ready(game)` returns
    `NOT private_sec.guardian_payment_approval_missing(auth.uid(), game)`, false for no caller. Read-only (STABLE,
    SECURITY DEFINER, `search_path = ''`), EXECUTE for `authenticated` only (not PUBLIC, anon or service_role), no
    player argument: it answers about the caller only. No existing RPC answered this: `game_payment_guardian_ready`
    adds the adult exemption, and the rule itself is in `private_sec`, not callable through the API. The trigger, the rule, `game_payment_guardian_ready` and PayPal
    are untouched. The 955 test checks the check and the trigger agree for 7 accounts x 2 games (adult, 17 with no
    link, guarded 16 before and after approval and after a host rejection, 18 and 25 with an old link, the
    guardian, the host), the adult case before and after a guardian approval (for that game only) and after the
    guardian ends the link, and that PayPal's check still exempts the adult.
  - Pay page: once nothing else stands in front of the payment options (payEntryView 'clear', no approval card, no
    "Before you join", the host's settings loaded) and the host has a manual method, `payManualMethodsStep` decides:
    the check says yes: every method, as before; still loading: "Loading payment options…" in place of the manual
    list (no handles, no proof form); failed with nothing loaded: "We couldn't check…" with Retry in place of the
    manual list. In both of these PayPal stays where it was before this check existed (offered and no manual method
    picked), because PayPal's server precondition asks `game_payment_guardian_ready`, not this check: a missing
    function (the app shipped before the migration, or the migration rolled back on its own) costs the manual methods
    only, never PayPal. PayPal and what stands in place of the list share one container, so the PayPal button is not
    mounted again when the check answers. Says no and PayPal is offered: PayPal only,
    with the notice "Manual payments need a guardian's approval" (no Venmo, Cash App or other method, no proof form,
    no "Pay the host → Confirm" stepper); says no and PayPal is not offered (not set up, or an ended game): the
    block card (`data-block="manual_guardian"`), not an empty method list; says no and PayPal has not settled yet:
    loading. A method picked automatically when the host has one does not count as "already shown how to pay" while
    it is held back (`proofStepOnScreen` needs the manual methods offered). A method resumed from the pay-opened
    marker does count: the marker means the viewer really opened Venmo or Cash App, so `paymentStarted` is set and
    the notice adds the refund line.
  - Wording (adult, no "ask your parent"): "A guardian link from before you turned 18 is still active on this
    account, so Venmo, Cash App and other manual payments for this game need your guardian's approval first." then
    "You can pay with PayPal now. Or go back to the game to ask your guardian to approve it. Your guardian can also
    end the family link from their Parent Center." (without PayPal: from "Go back to the game", in the block card).
    A managed account (`app_metadata.managed`, `isManagedUser`) is not told the link can be ended: its managing
    guardian is refused by `revoke_guardian_link` (MANAGED_CHILD_DELETE_INSTEAD, 20261110120000), and a managed
    child's stored birthday reaches 18 like anyone's (`manualGuardianHoldNext`). A
    viewer who was already shown how to pay also reads "Don't send the host money by Venmo, Cash App or another app
    for it. If you already paid, message the host to ask for a refund." (the block card keeps its own "If you
    already paid, message the host to ask for a refund.").
  - Ending the link: only the guardian can, from the Parent Center ("End family link", `revoke_guardian_link`,
    which is guardian-only and refused for a managed child's link). The player has no way to end it themselves, so
    the page points them to their guardian; no new way was invented. Approving the game: the game page already
    sends this adult to ask their guardian on a paid open game (`guardianOnlyJoin` asks on any paid game, whatever
    the age), which is the request the guardian approves.
  - The answer is asked again when the viewer's request changes (status, guardian stamp), and every 15 s while it is
    no (a guardian approving or ending the link on their own device), as `useGamePaymentGuardianReady` does.
  - The game page's Payments tab (`PlayerPaymentsPanel` → `PaymentPoliciesCard`, "Accepted methods") listed the same
    handles from `get_game_host_payment_methods`, which has no guardian check. It now asks the same check and shows
    the handles and the host's payment instructions only when it says yes: hidden while it loads or failed, hidden
    with the notice's first sentence when it says no. The method names (Venmo, Cash App) stay. The host's own card is
    unchanged. `get_game_host_payment_methods` itself still returns the handles to this viewer (see (a)): the client
    no longer shows them, the API still does. Changing that RPC would be a server change for an owner decision.
  - Open owner question: managed accounts at 18. Their link cannot be ended by the guardian (only the profile
    deleted), so a managed account that reaches 18 can pay a manual method only for a game the guardian approves.

  | Piece                    | Where                                                                                                  |
  | ------------------------ | ------------------------------------------------------------------------------------------------------ |
  | The trigger's rule, read | `supabase/migrations/20261124200000_manual_claim_guardian_ready.sql`                                   |
  | SQL test                 | `supabase/tests/955_manual_claim_guardian_ready.test.sql` (58 assertions; fails without the migration) |
  | Rollback                 | `docs/rollbacks/20261124200000_manual_claim_guardian_ready.down.sql` (guarded; rehearsed)              |
  | Decision                 | `src/lib/pay-entry-gate.ts` (`payManualMethodsStep`); tests in `src/lib/pay-entry-gate.test.ts`        |
  | Hook                     | `src/hooks/use-game-payment-guardian-ready.ts` (`useGameManualClaimGuardianReady`)                     |
  | Pay page                 | `src/routes/games.$gameId.pay.tsx`                                                                     |
  | Payments tab             | `src/components/GamePaymentsPanel.tsx` (`PlayerPaymentsPanel`, `PaymentPoliciesCard` `manualHandles`)  |
  | E2E (mocked)             | `e2e/pay-manual-guardian-hold.spec.ts`                                                                 |

- (a) `get_game_host_payment_methods` (20261111120000 §2) returns the host's handles to any caller who can see the
  game, including a 13-15 who may not pay. The handles are an adult's (adult payee only), so this is a minor-safety
  question rather than a privacy leak. It could add `public.game_payments_allowed(auth.uid())`.
- (b) Done in the client (section 5): /pay calls `game_payment_guardian_ready(game)` and blocks with the `guardian`
  kind, failing closed while it has not answered.
- (c) The pay page reads `requires_approval` from the settings row (L478 base). A prospective viewer cannot read
  that row (can_read_game_payment_settings: payee, approved requester, payer or participant only, 20261103140000
  L57-70), so for a fresh viewer `settings` is null: `requiresApproval` reads false and the methods list is empty.
  Derived from the policies, then confirmed live (see "(c) checked on the local stack" above): a fresh player on a paid **open** game who taps "Pay Host" lands
  on "Host hasn't set up payment yet. Message the host directly to arrange payment." (no handles, no PayPal: both
  need `settings`). The E2E specs mock the settings row, so they do not see this. Worth its own task: give /pay the
  public join policy (useGameJoinPolicy, as the game page does) and a payee-scoped way to read the methods and
  PayPal config for a viewer who passes payEntryBlock.

  **Built on branch claude/pay-fresh-viewer-methods (owner decision 2026-11-20, "Continue session as you
  recommend"). Client only: no migration, RLS and every RPC unchanged.**

  - `paySetupFrom` (src/lib/pay-entry-gate.ts) decides who is paid and whether the host screens players. A viewer who
    can read the settings row gets it from the row, as before. For a viewer RLS hides it from, the page asks
    `get_game_join_policy(game)` (the payee's row, for anyone who can see the game: what the game page's
    `useGameJoinPolicy` reads) for `requires_approval`, and takes the payee to be the game's host
    (`hosted_games.host_id`, which is `private_sec.game_payee`). The methods then come from
    `get_game_host_payment_methods(payee, game)`, whose own guards are unchanged (payee only, a caller who may
    coordinate payments, an adult payee, a game the caller can see, the payee row's accepted methods). The
    approval card still shows for an approval-required game (`requires_approval` true from the policy).
  - Fails closed: a failed or timed-out policy read is the "Couldn't reach the payment service" Retry, never "no
    approval needed". The policy answers with no row when the payee has no settings row at all; then nothing is
    offered, as before ("Host hasn't set up payment yet"), and PayPal's precondition would refuse such a player
    anyway (HOST_APPROVAL_REQUIRED).
  - PayPal: its config already comes from a public source (`getPayPalCheckoutConfig` → `get_game_host_paypal`), and
    `paypal_payment_precondition` lets this viewer pay, so the button is drawn once the page has a payment setup
    (it needed the settings row before). It still is not drawn without one: a PayPal config alone no longer turns the
    page into an empty "How do you want to pay?" list.
  - Every gate in front of the options is unchanged and still decides first: the entry block (#430/#436), "Before
    you join", the age range, the guardian checks, the manual-claim hold (#440).
  - Still read from the settings row only, so not shown to a viewer who cannot read it until they have paid or been
    approved (then RLS lets them read it): the host's general payment instructions (`payment_instructions`; each
    method's own instructions do come from the RPC), the payment deadline, and `entry_fee` (the page shows the
    game's `price`, as the game page does for that viewer; PayPal charges `entry_fee`, computed on the server). If
    the host changed the fee after creating the game, that viewer sees the old price until they can read the row.
    Exposing these through a public RPC would need a migration and an owner decision; not done.

- (e) **Full game on the pay page (owner decision 2026-11-20, "Continue session as you recommend").** Since #434
  `private_sec.payment_claim_block` refuses a manual claim, and PayPal's precondition refuses checkout, from a player
  not on the roster when the roster count is at least `GREATEST(max_players, 1)` (GAME_FULL), whatever the host
  approved. The pay page only warned ("This game just filled up…") above the host's handles. Built on branch
  claude/pay-fresh-viewer-methods:

  - New block kind `full` in payEntryBlock, with the game page's words for a full roster ("The roster is full — no
    spots left.", `ROSTER_FULL_MESSAGE`). Only a viewer on the roster, and the host, are exempt; a host-approved
    viewer or one with a payment in is still blocked, as the database decides. Asked after the lock rules and
    before the age range (the host's approval would not make room, so "Waiting on host approval" would mislead). It
    outranks the approval card. `rosterIsFull` is the database's count rule.
  - Count: the page's existing source, `hosted_games.joined` (game_participants_sync_count keeps it equal to the
    participant rows): the live store once it has loaded, or the by-id lookup's read for a game the store does not
    hold. Fails closed: until the count is known a viewer it could block sees "Loading payment options…", and a
    failed first load of the store shows the Retry (which reloads it); a viewer on the roster and the host never wait
    for it.
  - The block card replaces every payment option and the proof form. A viewer who was already shown how to pay (a
    method picked, or Venmo/Cash App opened from the page) keeps the refund line ("If you already paid, message the
    host to ask for a refund."). The soft warning and `showFilledUpWarning` are removed.

  | Piece          | Where                                                                                                                    |
  | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
  | Decisions      | `src/lib/pay-entry-gate.ts` (`paySetupFrom`, `rosterIsFull`, the `full` block, payEntryView's `roster`)                  |
  | Unit tests     | `src/lib/pay-entry-gate.test.ts` (137; 21 new), `src/lib/roster-placeholders.test.ts` (wiring)                           |
  | Pay page       | `src/routes/games.$gameId.pay.tsx`                                                                                       |
  | E2E (real RLS) | `e2e/pay-fresh-viewer-methods.spec.ts`: real games, settings and method on the local stack (skips on any hosted project) |
  | E2E (mocked)   | `e2e/pay-entry-blocked.spec.ts` (4 new full-game tests)                                                                  |

## 7. Product decision: should paid joins show "Before you join"?

**Decision (owner, 2026-11-18): Option B**, built in round 5 (section 5e). The pay page asks it before any payment
option, for every entry (the game page's Pay Host link, an invite, a bookmark). Option C (server enforcement) is not
built: nothing on the server requires the acknowledgment yet.

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

### Section 6 (branch claude/payment-claim-preconditions, 2026-11-18)

- SQL, private disposable Postgres 16 with `node scripts/db-test.mjs` (as the Database tests workflow runs it): 2687
  passed, 0 failed; `900_payment_claim_preconditions` (numbered 870 before the rebase onto main, which took 870 for `870_availability_expiry_job`) 100 passed, `762_paypal_payment_preconditions` 90 passed
  (unchanged file).
- Negative controls: without the migration (main's replay) 900 errors at its first call; with the trigger dropped 35
  assertions fail; with every writer checked the host and service-role exemptions fail; without the roster exemption 5
  fail; without the approval exemption 3 fail; with the old payment-methods body 4 fail; with the helper granted to
  `authenticated` 1 fails; with PayPal asking the shared rules first 4 fail in 900 and 1 in 762.
- Rollback rehearsal on a copy: refuses unconfirmed; refuses (changing nothing) when `payment_claim_block` was
  changed; confirmed, restores `paypal_payment_block` and `get_game_host_payment_methods` to main's md5s with grants
  intact (762 and 340 pass); the migration then re-applies cleanly.
- E2E, local stack with the migration applied, via run-e2e.sh: every e2e/pay-\*.spec.ts, e2e/invite-pay-and-join\*,
  leave-verified-payment-consistency, fixture-age-gated-flows and invite-fallback-params (21 files, 39 tests): 39
  passed, 0 failed.

### Section 6, review round (rebased onto main 429ac2f2, 2026-11-18)

- Rebased onto main after #430 (pay entry gate). Its `warn` mode told a player who had started paying to "submit proof
  below" under a lock or participation block, which the new trigger refuses; the mode is removed (5b). The SQL test is
  now `900_payment_claim_preconditions` (main took 870).
- SQL, private disposable Postgres 16 with `node scripts/db-test.mjs`: 2720 passed, 0 failed (900: 100, 762: 90).
  Negative controls re-run on the new replay: no migration, 900 errors at its first call (118 errors, 0 ok); trigger
  dropped 35 fail; every writer checked 3 fail and 24 error; roster exemption removed 5; approval exemption removed 3;
  old payment-methods body 4; helper granted to `authenticated` 1; PayPal asking the shared rules first 4 in 900 and
  1 in 762.
- Rollback rehearsal on a copy of the new replay: refuses unconfirmed; refuses (changing nothing) with
  `payment_claim_block` changed; confirmed, restores `paypal_payment_block` (d234777c…) and
  `get_game_host_payment_methods` (0749f4a8…) with grants intact, 762 and 340 pass and 900 errors; the migration then
  re-applies and 900 passes.
- Unit: `npx vitest run` 4252 passed, 22 skipped (412 files).
- E2E, local stack with the migration applied (the function md5s match the replay), via run-e2e.sh: every
  e2e/pay-\*.spec.ts (now including pay-entry-blocked), e2e/invite-pay-and-join\*, leave-verified-payment-consistency,
  fixture-age-gated-flows and invite-fallback-params (22 files): 42 passed, 0 failed.

### Round 5 (branch claude/pay-risk-ack-age, owner decisions 2026-11-18)

- `npx vitest run` (full): 407 files, 4253 passed, 22 skipped (none added here). pay-entry-gate.test.ts: 92;
  use-my-age.test.tsx: 4; PaymentRequiredBanner.test.tsx: 3.
- `npx tsc --noEmit -p .`: clean. `node scripts/lint-changed.mjs`: none adds ESLint errors.
  `node scripts/format-changed.mjs`: formatted.
- E2E, local stack via run-e2e.sh (stack recreated from main's migrations; no migration in this round): all
  `e2e/pay-*.spec.ts`, `e2e/invite-pay-and-join*.spec.ts`, `e2e/invite-deeplink-*.spec.ts`, risk-ack-before-join,
  pay-entry-blocked, plus fixture-age-gated-flows, invite-fallback-params, leave-verified-payment-consistency and the
  two trainers-venue-filter specs (booking sheet): 28 files, **52 passed**, 0 failed, 0 skipped, 0 flaky (4.1 min).
- Mutation checks. E2E: with the pay page's age range dropped (`ageReq: null`) and "Before you join" forced to `none`,
  the two age-range block tests in pay-entry-blocked and pay-risk-ack-before-pay fail (3 failed, 4 passed: the
  approved-viewer age test passes either way, as it should). Unit: each of these fails at least one test: the
  banner's `takesPayment` check removed; `!pending` dropped from unpaidOnGameTakingNoPayment; payRiskAckView showing
  the options while the read waits, or while the flow state loads; the age block's approved exemption removed; an age
  still loading counted as in range; useMyAge ignoring an RPC error.

### Round 6 (review fixes, branch claude/pay-risk-ack-age)

- Fixed: "Before you join" waits for the host's settings (`payRiskAckStep`); a successful ack write lifts the dialog
  even when the re-read fails (`safetyAckQueryKey` + setQueryData); a pending viewer outside the age range on an open
  game gets "Waiting on host approval" (`payAwaitsApproval`); useMyAge is keyed by the signed-in account.
- `npx vitest run` (full): 407 files, 4264 passed, 22 skipped. pay-entry-gate.test.ts: 102; use-my-age.test.tsx: 5.
- `npx tsc --noEmit -p .`: clean. `node scripts/lint-changed.mjs`: none adds ESLint errors.
  `node scripts/format-changed.mjs`: formatted.
- E2E, local stack via run-e2e.sh: pay-risk-ack-before-pay and pay-entry-blocked, 11 passed (4 new tests).
- Mutation checks. E2E: with the three page fixes reverted (settings not awaited, re-read only, age-pending not an
  approval wait) the four new tests fail and the other seven pass. Unit: payRiskAckStep without the settings check
  fails 3 tests; payAwaitsApproval without the age clause fails 1; useMyAge keyed without the user id fails 1.

### Section 6 (d) (branch claude/guardian-adult-manual-claim, owner decision 2026-11-18)

- SQL: `955_manual_claim_guardian_ready` 58 passed. Negative control: with the migration file moved out of the
  replay, 955 stops on "function public.game_manual_claim_guardian_ready(text) does not exist" (0 passed, 1 failed).
- Rollback rehearsal on a scratch replay: refuses unconfirmed (function kept); refuses, changing nothing, when the
  function's definition differs from the migration's (md5); with the confirmation it drops the function and leaves
  the guardian trigger and `game_payment_guardian_ready` in place; a second run refuses (function gone); re-applying
  the migration restores the same definition (md5 `109ac8d2…`) and grants.
- `npx vitest run` (full): 411 files, 4334 passed, 22 skipped. pay-entry-gate.test.ts: 114 (9 new).
- `npx tsc --noEmit -p .`: clean. `node scripts/lint-changed.mjs`: none adds ESLint errors.
  `node scripts/format-changed.mjs`: formatted.
- E2E, local stack via run-e2e.sh, with the migration applied to the stack: all `e2e/pay-*.spec.ts` (including the
  new pay-manual-guardian-hold) and `e2e/invite-pay-and-join*.spec.ts`: 21 files, **40 passed**, 0 failed (3.4 min).
- Mutation check: with `payManualMethodsStep` always answering 'offer_all', three of the four new E2E tests fail (the
  "check says yes" test passes, as it should).
- Review fixes (PayPal kept while the check loads or failed; Payments tab handles; managed-account wording): unit
  `pay-entry-gate.test.ts` 116; full `npx vitest run` 411 files, 4336 passed, 22 skipped; SQL 955 58 passed and the
  negative control unchanged (0 passed, 1 failed without the migration); rollback rehearsed again on a scratch
  replay (refuses unconfirmed; drops with the confirmation, the trigger and `game_payment_guardian_ready` kept;
  refuses a second run; re-apply gives md5 `109ac8d2…`, EXECUTE for authenticated, not anon). E2E, all
  `e2e/pay-*.spec.ts` and `e2e/invite-pay-and-join*.spec.ts`: 21 files, **43 passed** (pay-manual-guardian-hold: 7).
  Mutation check: with PayPal never drawn beside the check's loading or failed state, and with the Payments tab
  always showing handles, the three tests that cover these fail; the other four pass.

### Section 6 (c) and (e) (branch claude/pay-fresh-viewer-methods, owner decision 2026-11-20)

- No migration, no SQL test: client only.
- `npx vitest run` (full): 450 files, 4785 passed, 22 skipped. pay-entry-gate.test.ts: 137 (21 new).
- `npx tsc --noEmit -p .`: clean. `node scripts/lint-changed.mjs`: none adds ESLint errors.
  `node scripts/format-changed.mjs`: formatted.
- E2E, local stack via run-e2e.sh (this branch's migrations, #440's 20261124200000 included): all
  `e2e/pay-*.spec.ts` (including the new pay-fresh-viewer-methods) and `e2e/invite-pay-and-join*.spec.ts`: 22 files,
  **50 passed**, 0 failed (4.5 min).
- Negative control: with the pay page (and spots-urgency) as they were on the base commit, all three
  pay-fresh-viewer-methods tests fail against the real database: the open game shows "Host hasn't set up payment
  yet", the approval game shows the same instead of "Waiting on host approval", and the full game shows no block.
- Mutation check: with payEntryView never treating the roster as full, 4 unit tests fail and the four full-game E2E
  tests (three mocked, one real) fail; the other ten tests in those two files, the rostered-viewer one included,
  pass.
