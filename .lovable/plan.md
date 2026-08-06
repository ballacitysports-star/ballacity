# Availability gates: post as a player, complete before team game actions

Two related rules:

1. Posting player availability requires a usable **player** (or trainer) profile.
2. Before you can request to join a game, or manage games under your team, the app prompts you to complete your player availability.

## 1. Posting availability requires a player/trainer profile

Every account keeps a permanent player profile, so the real gate is that the profile is usable and that you aren't acting as a gym.

Availability can be posted when:
- you're signed in, AND
- your active profile is `player` or `trainer`, AND
- your player profile has a display name and at least one favorite sport with a level.

Behavior:
- **Acting as gym or team**: the "+" post button and the Mine tab show "Availability is posted from your player profile" with a one-tap "Switch to my player profile" action (uses the existing profile switcher mutation), then reopens the post dialog.
- **Player profile incomplete**: show "Add your sports and level to post availability" with a link to `/profile/edit`.
- **Signed out**: keep the existing "Sign in to post your availability" toast.
- The Post/Edit availability dialog itself refuses to save when the gate fails, so deep links and stale dialogs can't bypass it.

## 2. Complete availability before joining or managing team games

A new prompt appears when you take a game action but have no open availability post:

- **Joining a game** (Request to join / Pay & join on the game page): a dialog explains that hosts match players from availability, with "Add my availability" (opens the post flow) and "Continue anyway" (soft prompt — the join still proceeds after one dismissal per session).
- **Managing games under your team** (create-game flow and the team roster/manage views): a dismissible banner at the top prompting the same thing, with the same "Add my availability" action. Management is not blocked.

"Complete availability" means at least one `player_availabilities` row with `status = 'open'`, at least one sport, and at least one time slot.

## Technical notes

- New `src/lib/availability-gate.ts`: `useAvailabilityGate()` returns `{ canPost, reason, hasOpenAvailability, loading }`, combining `useMyProfiles()` (active kind), `useMyProfile()` (sports/level), and a `listMyAvailabilities()` query.
- New `src/components/availability/AvailabilityPromptDialog.tsx` (join prompt) and `AvailabilityRequiredNotice.tsx` (inline gate/banner). Session dismissal stored in `sessionStorage`.
- Wire-ups: `src/routes/_tabs.players.tsx` (post button + `PostAvailabilityDialog.save`), `src/components/players/MineView.tsx` (empty state), `src/routes/games.$gameId.index.tsx` (before `executeJoinAction`), `src/routes/_tabs.create.tsx` and the team manage view (banner).
- No schema or RLS changes; all client-side presentation and existing queries.
