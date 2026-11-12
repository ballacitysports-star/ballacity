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

- **GA4 is live, and the clean window starts later.** `vite.config.ts` has baked in the measurement id
  `G-MEWLGXSWXC` since #209 (2026-10-28), so the tag loads for confirmed adults in production. Until the
  change that keeps it out of development builds (`AnalyticsHost` does nothing when `import.meta.env.DEV`
  is true), `vite dev`, the Playwright dev server used by E2E and Lovable's live preview loaded it too
  and reported to the same property. Count the clean window for this decision from the publish that
  carries that change; earlier `select_tab` and `open_create` events include test and preview sessions.
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

## Owner decisions (recorded 2026-11-06)

- **Analytics vendor (P0-8): GA4.**
  - _Correction, 2026-11-11._ The original note said the measurement id still had to be created
    and that these events sent nothing. That does not match `main`. `vite.config.ts` sets
    `VITE_GA_MEASUREMENT_ID` at build time from `GOOGLE_ANALYTICS_MEASUREMENT_ID`, and when that is
    unset it falls back to a GA4 measurement id written into the file (added on 2026-10-28, #209).
    So every build, the published one included, loads the tag for confirmed adults
    (`src/components/AnalyticsHost.tsx`); `.env.production` does not need the variable. Dev, E2E and
    preview builds loaded it too until #395 (merged 2026-11-12), which limits it to the published build from
    the next publish on.
  - Whether the property has received data, and so when the four-week clock below started, cannot
    be read from the repository. The owner checks it in Google Analytics and records the date here.
- **Decision rule: accepted as written above.** No tab change is made before it is met.
- Retention windows for analytics data are left to the owner's counsel, with the other legal items.
