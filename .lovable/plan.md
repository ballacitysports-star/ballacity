# Monetization architecture — recommended first pass

You asked what I recommend. Rather than building all ten phases at once (much of which would be unused scaffolding), I recommend shipping the foundation plus the two products you can actually sell today, and leaving teams / leagues / facilities / sponsorship as configuration-ready slots that light up later without a rebuild.

## What already exists (audit)

Your app already has more monetization than the brief assumes, and none of it should be rebuilt:

- **Real Stripe billing.** Embedded checkout, billing portal, and a signature-verified webhook that writes subscription and one-time purchase records. Test and live money are kept in separate partitions.
- **Four plans on sale** — AI Highlight Reels $15, Host Subscription $10, Team $49, Org $99 — with prices written into the code.
- **Direct host payments, fully built.** Host payment handles (Venmo, Cash App, Zelle, PayPal, Apple Cash, Google Pay, cash, custom), per-game fee and instructions, a seven-state payment lifecycle, player "I paid" claims with proof, host confirm/decline, disputes, cancellations, scam reporting, and an age gate. Enforced in the database, not just the screens.
- **A settings table** already used for youth policy, so admin-editable configuration has a home.
- **Admin payment review** in the superadmin area.
- Access to paid features is decided today by asking "does this person have any active subscription", scattered across screens.

Two real gaps: there is no single place that defines prices, fees and who-gets-what; and paid access is judged per screen rather than centrally.

## Recommendations

1. **Fold, don't replace.** Host Subscription becomes **Host Pro**, AI Highlight Reels becomes **ballaCity+** (reels included), Team and Org stay as the team/organization tiers. Everyone already subscribed keeps everything — old plan identifiers stay recognised permanently.
2. **Reuse your existing Stripe prices** so the new plans are buyable the moment this ships. Launch amounts stay whatever Stripe currently holds; you change the amount in Stripe and the pricing page follows, no code change. My suggestion when you're ready: ballaCity+ $9.99, Host Pro $19.99.
3. **Skip revenue-by-sport and by-region for now.** Those need attribution recorded at purchase time, so they'd read as empty or misleading for months. Everything else on your dashboard list is reportable from data you already have.
4. **Keep direct host payments free.** No platform cut on money ballaCity never touched — that's the single biggest trust asset you have, and the audit doc already commits to it publicly.

## What gets built

**One place for all pricing and rules.** Plan names, prices, trial lengths, platform fee, processing fee, fee minimum/maximum, promotional pricing, and which features each tier unlocks — all in one configuration module, with admin-editable overrides stored in the database for prices, trials and fees. No business number written into a screen anywhere.

**One entitlement system.** A single question — "does this account have Host Pro / ballaCity+ / Team Pro?" — answered from trusted server-side subscription state, checked in the database for anything that matters. Every current scattered check gets rewired to it. Nothing a person can change in their own browser grants paid access.

**Free stays genuinely free.** Accounts, profiles, discovery, search and filters, game details, joining, permitted hosting, messaging, availability, teams, reputation. Untouched, and protected by a test that fails if any of them ever gets gated.

**Host Pro, live.** Unlimited listings, recurring games, waitlists, automatic payment reminders, attendance and no-show tracking, host analytics with expected-vs-confirmed fee totals, private games, featured-game capability. Where a capability doesn't exist yet, its entitlement slot exists and the upgrade prompt doesn't claim it.

**ballaCity+, live.** Unlimited AI reels (three free ones stay free for everyone), advanced discovery filters, enhanced profile with a member badge, advanced stats and availability, recruiting visibility.

**Direct payments, preserved and clarified.** The existing flow keeps working exactly as it does. Status wording is aligned to Unpaid / Marked paid / Confirmed / Cancelled / Refunded, hosts get expected-vs-confirmed totals and a reminder action, and every payment screen keeps saying plainly that this is money between player and host and ballaCity cannot move or refund it.

**Future platform-processed payments.** Each paid game is explicitly marked as *direct to host* or *processed by ballaCity*, with a fee breakdown calculated server-side from the shared configuration and shown in full before anyone pays. No transaction is ever simulated: until a processor is connected, the processed option simply isn't offered.

**Admin revenue dashboard.** Total revenue, monthly recurring revenue, subscription vs transaction split, revenue by product, active/new/cancelled subscriptions, churn, tier mix, free-vs-paid conversion, host and player counts, paid game counts, and refunds/failures. Admin-only, enforced in the database.

**Slots for later.** Team Pro, organization and facility tiers, leagues/tournaments/camps, featured placements and sponsored slots exist as configured products with entitlement names reserved — inactive, nothing sold, no half-built screens. Turning one on later is configuration plus its own screens, not a redesign.

**Security and quality pass.** Full review of who can read and change payment and subscription records, host and game ownership, admin permissions, secret handling, webhook signature verification and duplicate-event protection. Plus responsive checks at phone, tablet and desktop widths in Safari and Chrome, and confirmation that the feed and discovery stay fast.

You'll get a written audit at the end covering everything found, everything changed, security and access findings, tests run, anything left open, and what I'd monetize next.

## Technical section

- **Config:** new `src/lib/monetization/config.ts` (typed defaults: tier definitions, price ids, display prices, trial days, `platform_fee_bps`, `processing_fee_bps`, fee min/max, promo codes) with admin overrides read from `app_settings` under a `monetization` key via a cached server function, mirroring `loadAgePolicy`. `catalog.ts` becomes a thin view over it; `PLAN_TIERS` keeps its shape so `/plans` and `/shop` keep working.
- **Entitlements:** `src/lib/monetization/entitlements.ts` — `TIERS` (`player_free|player_plus|host_free|host_pro|team_free|team_pro` + reserved org/facility), `PRICE_ID_TO_TIER` including legacy ids, `entitlementsFor(subscriptionRows, now)`, `hasEntitlement(state, key)`. Client hook `useEntitlements()` replaces direct `isActive` reads in `_tabs.reels.tsx`, `plans.tsx`, `SwayCards`, `WeeklyQuickPick`, `ProfileSwitcher`. Server side: SQL `public.has_entitlement(_user_id uuid, _entitlement text)` (security definer, stable) derived from `subscriptions` + `environment`, reusing the existing `has_active_subscription` logic; used by RLS/policies and server functions for anything gated. No entitlement is ever accepted from client input.
- **Subscriptions table:** add nullable `tier text`, `trial_end timestamptz`, `canceled_at timestamptz`, `metadata jsonb`; webhook populates them. No column renames, no destructive changes. Index on `(user_id, environment, status)`.
- **Fees:** `src/lib/monetization/fees.ts` pure functions (`quoteFees({ amount, mode })`) + server-side recompute before any processed charge; `game_payment_settings` gains `payment_mode text default 'direct_host'` constrained to `direct_host|ballacity_processed`, and processed mode is rejected server-side while no processor is wired.
- **Admin analytics:** `src/lib/monetization/analytics.functions.ts` server functions using `supabaseAdmin` after verifying `has_role(admin|superadmin)`, aggregate SQL only (no full history to the client); rendered in a new `MonetizationTab` in the existing superadmin shell.
- **Payment status vocabulary:** keep `PAYMENT_STATES` as the internal source of truth; add a display mapping to the requested five labels rather than migrating stored statuses.
- **Tests:** vitest for entitlement derivation (active/trial/past due/cancelled-but-in-period/expired, legacy price ids), fee math, free-tier guard; existing payment integration tests must keep passing. Playwright for `/plans`, the reels gate, host payment panel, and admin tab at 320/390/768/1280.
- Untouched: auth, profiles, messaging, games, teams, family/parent architecture, existing RLS on payment tables, direct-payment triggers.
