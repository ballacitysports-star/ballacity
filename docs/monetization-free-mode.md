# Free mode — ballaCity is temporarily free for everyone

ballaCity currently charges nobody. No paywall, checkout, upgrade prompt or
premium lock appears anywhere in the normal member experience.

**Nothing was deleted to achieve this.** Products, prices, Stripe wiring, the
billing webhook and every entitlement check are all still in place. Free mode is
one switch, and turning it off restores the paid product exactly as it was.

## The switch

`app_settings.monetization → access.billingEnabled`, edited from
**SuperAdmin → Monetization**. `false` (the shipped default) means free.

| Setting | Effect while billing is off |
| --- | --- |
| `billingEnabled` | Master switch. `false` = free for everyone. |
| `freeModeEntitlements` | Which entitlements every account is handed. Defaults to all five. |
| `freeModeAiTier` | AI quota tier everyone resolves to (`gym` by default). |
| `freeModeNotice` | Copy shown where a paywall used to be. |
| `subscriptionsEnabled` / `merchShopEnabled` / `upgradePromptsEnabled` | Per-surface switches, only consulted once `billingEnabled` is `true`. |

Prices, trial lengths, fees and the reel allowance are editable in the same
panel. Leaving a field alone means "use the built-in default" — the panel writes
only overrides, never a snapshot of the defaults.

## How it is enforced

Everything funnels through one resolver, `resolveFeatureAccess` in
`src/lib/monetization/access.ts`. No screen keeps its own idea of "is this
account paid".

- **Client** — `useFeatureAccess()` (built on `useEntitlements`). `has()` returns
  true for every entitlement while free.
- **Server** — `loadMonetizationConfig()` in
  `src/lib/monetization/settings.server.ts` (30s cache, per-isolate). Used by the
  AI gate (`resolveAiTier`), `createCheckoutSession` and the sitemap.
- **Database** — `public.monetization_free_mode()`, consulted by
  `public.has_entitlement`.

All three **fail open to free**: a missing, unreadable or malformed settings row
resolves to free rather than to a paywall. A settings blip must never charge or
lock out a member.

## What free mode deliberately does *not* touch

- **Player→host game fees.** Players pay hosts directly in Venmo / Zelle / Cash
  App / PayPal or cash; ballaCity never holds those funds. A host charging for a
  court booking is core functionality, not a ballaCity paywall. See
  `docs/payment-architecture-audit.md`.
- **Existing subscriptions.** Nobody is auto-cancelled. The billing webhook keeps
  recording subscription state, and **Manage billing & cancel** stays on `/plans`
  so an existing subscriber can always cancel.
- **Age, youth and child-safety gates.** Those are safety gates, not paywalls.
- **AI quotas.** Per-tier daily/monthly caps still apply as a cost ceiling.
  "Free" is not "uncapped" — tune `freeModeAiTier`, or the `ai_limits` setting,
  to control spend.

## Turning billing back on

1. SuperAdmin → Monetization → switch **"ballaCity is free for everyone"** off.
2. Confirm the per-surface switches (subscriptions, merch, upgrade prompts).
3. Set `VITE_PAYMENTS_CLIENT_TOKEN` if this build has no Stripe publishable key —
   without it checkout cannot open, though the billing portal still works.

Members see the change within about five minutes (the client config's
`staleTime`), or immediately on a hard reload.

`src/lib/monetization/access.test.ts` asserts this round-trip in both
directions — free mode grants everything, and re-enabling billing restores real
entitlement gating.
