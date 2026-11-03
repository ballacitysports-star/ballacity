# Youth privacy permission matrix

What each person can see or do around games that may include children. The database is the enforcement point;
the app mirrors it so screens never ask for, cache or show more than the database released. "Youth-inclusive" means
any game that is not an enforced adult-only range (a game with **no** age limit is youth-inclusive).

Migrations: `20261104100000` (2A, private location), `20261104110000` and `20261104120000` (2B, age, hosting,
payments, identity). Tests: `supabase/tests/320`, `330`, `335`; app tests under `src/lib/youth-*`, `src/components/youth`.

## 1. Exact location of a youth-inclusive game

| Viewer | Exact venue / coordinates | What they get instead |
|---|---|---|
| The host (adult, or an approved 16–17 host) | yes | – |
| A person on the roster (any cohort allowed to take part) whose entry fee is settled (a free game, or a verified payment) | yes | – |
| A person on the roster of a paid game whose payment is not yet verified | no | same coarse form until the payment clears |
| A verified, active guardian of someone on the roster whose fee is settled | yes | – |
| Manager of the game's team; admin/owner of the game's organization | yes | – |
| Guardian whose link is revoked or unverified | no | neighborhood label, coordinates to 2 decimals (~1 km) |
| Pending requester; approved requester **not yet on the roster**; waitlisted player | no | same coarse form |
| Guardian of a pending requester | no | same coarse form |
| Signed-in stranger: adult, 16–17, 13–15, under-13, unknown age | no | same coarse form |
| Anonymous visitor | n/a: youth-inclusive games are not visible to anonymous visitors at all | – |

Adult-only games (18+ enforced) are unchanged: location is public to everyone who may see the game.

App behavior: the store always holds the coarse form and overlays the exact venue only for rows the database
released (`hosted_game_private`, under the viewer's own rights), in memory only. Nothing exact is written to device
storage (`openrun.hostedGames.v2`; the old v1 cache is deleted), and the overlay is cleared on sign-out, account
switch and guardian/child profile switch. Maps draw an area (circle), never a pin, for approximate locations;
shares, calendar exports, notifications, API tools and the guardian dashboard use the coarse form unless the
person is on the roster.

Until the database switch (`app_settings.youth_location_privacy.coarsen`) is turned on and existing rows are
coarsened, the public columns still carry the exact venue over the network; the app hides them, the database does not yet.
The switch is guarded and one-way: it needs the adoption confirmation, a typed session confirmation and an exact private
copy of every youth game; once on it cannot be turned off, and nothing ever restores exact values into public columns
(recovery is by fixing forward). There is no per-player fee waiver in the data model yet.

## 2. Taking part (joining, requesting)

| Account | Adult-only game (18+) | Game with an age range | No age limit |
|---|---|---|---|
| Adult | yes, inside the range | only inside the range | yes |
| 16–17 | **never** | only inside the range | yes (other gates apply) |
| 13–15 / under-13 | **never** | only inside the range, with existing consent/guardian gates | yes, with existing gates |
| Unknown age | **never** | **no** | other gates apply |

A host's approval, a guardian's approval or an organization's approval **never** overrides the range: the request
cannot be created, and the roster insert is refused.

## 3. Hosting

| Account | Adult-only (18+) | Youth-inclusive free game | Youth-inclusive paid game |
|---|---|---|---|
| Adult | yes | yes | yes |
| 16–17 | **never** (not even with approval) | only with a single-use, expiring approval from a verified guardian or an adult administrator of the organization the game runs under | only if that approval names an adult **payment manager** |
| 13–15, under-13, unknown | no | no | no |

Approval records are scoped to one teen (and one organization), expire in at most 30 days, are re-validated when
used (link still active/verified, administrator still an adult admin), bind to the game, and can be withdrawn;
withdrawing closes new joins but never cancels or deletes the game. Existing games are not touched.

## 4. Payments

| Party | Rule |
|---|---|
| Payee of a payment submission, payment method, PayPal account, paid-game settings | confirmed adult only |
| Paid game with a minor host | only its payment manager (the approving guardian or organization admin) can be paid; role ends when the approval is withdrawn or their link/admin status ends |
| Payer | unchanged: under-16 cannot pay; 16–17 only after guardian approval; adults as before |

## 5. Identity of a youth host

| Surface | Adult host | 16–17 host |
|---|---|---|
| Public `host_snapshot` | name, username, avatar, rating | organizer only (team/organization name, else "Youth host"); no username, photo or rating |
| Profile link / direct-message button on cards and game page | yes | removed |
| `visible_avatars` (name/initials lookups) | returned | returned only to self, a verified guardian, people sharing a game/chat/team, people the profile's own visibility allows, admins |
| `profiles` row | by profile visibility | by profile visibility (already private by default) |
| API tools (`list_upcoming_games`) | as before | coarse location, no host id (except to the host) |
| Reviews / host statistics | as before | not shown (PRIV-1) |
| Game id in the public row | `host_id` | `host_id` remains in the row; it no longer resolves to a name for strangers |

## 6. Notifications and shared links

Reminders, push payloads and share captions for a youth-inclusive game carry the title, time and (at most) the
neighborhood plus "Open the game for the exact location". Share links carry only `/games/<id>`.
