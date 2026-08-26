# Age requirement on games, with host approval for out-of-range players

Hosts can set an age requirement when creating (or editing) a game. Players inside the range join normally. Players outside it — or with no birthday on their profile — can't join instantly: they must send a request and the host approves or declines.

## What the host sees

- New "Age requirement" block in the Create game screen, next to "Require my approval to join" and "Signup cutoff":
  - Off by default ("Any age").
  - Optional minimum age and optional maximum age (either or both, 5–99).
  - Helper line: "Players outside this range must request your approval to join."
- The same block appears in the game's host settings sheet on the game page, so it can be changed later.
- On the join-requests panel, a request from an out-of-range player is labeled, e.g. "Age 15 · outside 18+", so the host can decide with context. Players with no birthday show "Age not shared".

## What the player sees

- Game page and game cards show an age badge when set ("18+", "13–17", "Up to 17").
- In range: current behavior is unchanged (instant join, or request/pay if the host already requires approval).
- Out of range or birthday missing: the CTA becomes "Request to join" with a short line explaining why ("This game is 18+ — the host reviews requests outside that range."). No instant join, and payment stays gated behind approval as it is today.
- The host's approval is the only path in; if declined, the existing declined/resubmit rules apply.

## Technical section

Database (one migration):

- `hosted_games`: add `min_age int`, `max_age int` (both nullable), plus a validation trigger requiring `min_age <= max_age` and each value between 5 and 99.
- `validate_join_request()`: no change to the pending → approved → pay order.
- Instant join needs server-side enforcement: extend the `game_participants` insert path so a row can't be created for a game with an age requirement unless the joiner is in range or has an approved `join_requests` row. Implemented as a `BEFORE INSERT` trigger on `game_participants` that reads the game's `min_age`/`max_age` and the joiner's `profiles.birthday` (security definer, so RLS on birthday is not a problem).
- No new grants needed (columns on an existing table).

App:

- `src/lib/game-age.ts` (new): `ageRequirementLabel({minAge,maxAge})`, `isAgeEligible(age, req)`, and `ageGateState({ req, viewerAge })` returning `"none" | "eligible" | "needs_approval" | "unknown_age"`.
- `src/lib/games-store.ts` / `addHostedGame`: pass `minAge` / `maxAge` through; map the new columns in the game type and row mapper.
- `src/routes/_tabs.create.tsx`: age-requirement UI state + include in `addHostedGame` payload.
- `src/routes/games.$gameId.index.tsx`: read the game's age fields, fetch viewer age via the existing `profile_ages` RPC, and fold `needs_approval` / `unknown_age` into the existing `requiresApproval` computation so all CTA branches, the payment gate, and the roster copy follow it. Host settings sheet gains the same fields.
- `src/components/games/HostJoinRequestsPanel.tsx`: show the requester's age vs. the requirement, using `profile_ages` for the listed player ids.
- Game cards / badges: render the age label where skill and price badges already render.
