# Navigation decision: Reels tab or Create tab (P1-9)

Status: **not decided.** The bar stays as it is until the evidence below exists. This PR adds the
measurement only.

## The question

The bottom bar has five tabs, defined by `TABS` in `src/lib/navigation-gestures.ts`. Swiping uses
the same order:

| Home    | Discover   | Reels         | Inbox                    | Me         |
| ------- | ---------- | ------------- | ------------------------ | ---------- |
| `/feed` | `/players` | `/highlights` | `/messages` (and alerts) | `/profile` |

Create (`/create`, host a game) has no tab. People reach it from Home's "Create game" action, the
profile, team and facility pages, and the sport guides. The audit asks whether the third slot
should stay Reels or become Create. Its rule is to change the bar only once with evidence, not
twice on a guess.

## Options

| Option                   | Bar                                          | For                                                                            | Against                                                                                                                             |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| A. Keep Reels (today)    | Home, Discover, Reels, Inbox, Me             | No change for current users. Reels is the one surface every age group can use. | Hosting, the core pickup loop, stays one level down.                                                                                |
| B. Create replaces Reels | Home, Discover, Create, Inbox, Me            | Puts the core loop on the bar.                                                 | Under-13s and other members who may not host would get a tab that opens a "you can't host" screen. Reels moves to Home or Discover. |
| C. Create tab by cohort  | B for adults, A for members who may not host | Each person sees what they can actually use.                                   | Two bars to explain, support and test, and swipe order differs by account.                                                          |

Option C should not be chosen without data either. It is listed because the hosting rules
(`game_hosting` in the child-status policy) already differ by cohort, and that is the strongest
argument against B.

## Evidence we have today

None that is quantitative.

- **No analytics yet.** The funnel analytics tag only loads when `VITE_GA_MEASUREMENT_ID` is set.
  It is not set in `.env.production`, and P0-8 (choosing an analytics vendor) is still open.
- **Adults only.** Even once the tag is live, it measures confirmed adults only. That is a privacy
  rule in `src/lib/analytics.ts`. Minors, likely the heaviest Reels users, will not appear in the
  numbers. Weigh that when reading them.

## What this PR measures

Both events are added to the allow-list in `src/lib/analytics.ts` and sent through `trackEvent`. So
the existing rules apply: adults only, nothing sent without the tag, and no personal data. The
helper is `src/lib/nav-analytics.ts`.

- **`select_tab`**, with `tab` (home, discover, reels, inbox or me), `from` (the tab the person was
  on, or `other`) and `via` (`tap` or `swipe`).
  - It fires when a bar tab is tapped or swiped to.
  - Re-tapping the tab you are already on is not counted.
- **`open_create`**, with `kind` (`run`, `open_court`, `clinic` or `tournament`; any other value
  becomes `other`).
  - It fires once when the Create screen opens.
  - The existing `create_game` event counts completions.

## Decision rule (proposal, for the owner to accept or change)

After analytics has been live for at least four weeks, with at least 200 weekly active adults:

1. **Reels share:** the share of `select_tab` events with `tab = reels`. Count taps only, because
   swipes pass through Reels on the way to Inbox.
2. **Create reach:** `open_create` per weekly active adult.
3. **Create completion:** `create_game` divided by `open_create`.

- Choose **B** (or **C**, if under-13 and other non-hosting members are a meaningful share of
  accounts) when both of these hold:
  - the Reels share is under 10 percent;
  - Create reach is at least half the reach of the Discover tab.
- Otherwise keep **A**, and look again after the next major Reels or hosting change.

Whatever is chosen is implemented once:

- change `TABS` and the `presentation` map in `src/components/BottomNav.tsx`;
- update `navigation-gestures.test.ts` and the swipe order;
- rollback is reverting `TABS`.

## Owner decisions needed

- Pick the analytics vendor and set the measurement id (P0-8). Until then these events send
  nothing.
- Accept or adjust the decision rule above.
- Or decide now without data. In that case this memo is the record of what was weighed.
