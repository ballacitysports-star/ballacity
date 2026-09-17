# Monetization & Feature Access

ballaCity is **free for every member right now**. No paywall, checkout, upgrade
prompt or premium lock appears anywhere in the normal experience.

**Nothing was deleted to achieve this.** Products, prices, Stripe wiring, the
billing webhook and every entitlement check are still in place. Monetization is
configuration, and a superadmin can stage it back on without a rebuild.

---

## 1. Current configuration

SuperAdmin → **Monetization**. Stored in `app_settings.monetization`, under
`access`.

| Setting | Ships as | Meaning |
| --- | --- | --- |
| `platformFreeMode` | **ON** | Master switch. Everything is free; features priced Premium are served as Free. |
| `subscriptionsEnabled` | OFF | `/plans` sells plans. |
| `paymentsEnabled` | OFF | Payment infrastructure is live. |
| `premiumFeaturesEnabled` | OFF | The per-feature Premium settings are enforced. |
| `checkoutEnabled` | OFF | Checkout sessions may be created. |
| `merchShopEnabled` | OFF | `/shop` is reachable and listed in the sitemap. |
| `upgradePromptsEnabled` | OFF | Upsell CTAs, past-due banners and paywall copy render. |
| `featureAccess` | `{}` | Per-feature Free / Premium / Disabled. Unlisted means Free. |
| `freeModeEntitlements` | all five | What every account holds while free. |
| `freeModeAiTier` | `gym` | AI quota tier everyone resolves to while free. |
| `freeModeNotice` | — | Copy shown where a paywall used to be. |

Every paid surface ships **off**, so turning Free Mode off is deliberately *not*
enough to start charging — each surface is switched on separately.

Prices, trial lengths, fees and the reel allowance are editable in the same
panel. Leaving a field alone means "use the built-in default": the panel writes
only overrides, never a snapshot of the defaults.

---

## 2. Feature access

Each feature is **Free**, **Premium** (requires a subscription once
`premiumFeaturesEnabled` is on) or **Disabled**. The registry lives in
`src/lib/monetization/features.ts`.

**Gateable** — real, optional capability:
`ai_reel_pipeline`, `ai_reel_coach`, `ai_reel_package`, `ai_reel_style`,
`ai_background_remove`, `reel_creation`, `merch_shop`.

**Always free** — the capabilities `ALWAYS_FREE_CAPABILITIES` protects
(discovery, joining, hosting, messaging, teams, reputation, availability, public
reels). Shown in the panel as locked rows, so it is visible that they exist and
are deliberately unpriceable.

**Never gateable** — `text_moderation` and `image_moderation`. Safety scanning
is not a product tier. The AI layer already exempts them from the kill switch,
consent, cohort and quota checks (`PLATFORM_FEATURES` in `ai/gate.server.ts`),
`moderation.server.ts` explicitly ignores the kill switch, and disabling them
*fails closed* — text becomes `"review"`, images become `{safe:false}`. Pricing
them would mean charging members not to have content held for review. A test
asserts they can never be configured.

### Deliberately not listed

No switch is shipped for something that governs nothing:

- `image_generate`, `image_enhance` — declared in `AI_FEATURES`, `enabled:false`,
  **no implementation**.
- Scouting reports, PDF export — no implementation at all (no `jspdf`, no
  `html2canvas`, nothing).
- Social publishing — only the native Web Share API; there is no publish
  integration to gate.
- Storage limits — there is no per-user storage quota concept. `maxUploadMb` is
  declared in the AI limits but never read at a call site; the real ceilings are
  the fixed `MAX_VIDEO_BYTES` / `MAX_IMAGE_BYTES` validators and the Storage
  bucket limit.

---

## 3. The safety / payment boundary

`canAccessFeature` in `src/lib/monetization/can-access.ts` is the one function
that composes the two, in this order:

```
1. account status    ─┐
2. safety             ├─ never bypassable
3. feature disabled  ─┘
4. free mode         ─┐
5. premium off        ├─ payment; free mode reaches only these
6. feature is free    │
7. entitlement held  ─┘
```

**Free Mode bypasses payment requirements. It can never bypass age, guardian,
safety, moderation, privacy or legal restrictions.** That is structural, not a
convention: steps 1–3 run first and short-circuit, so no monetization setting —
and no malformed settings row — can reach a safety decision.

A safety denial is passed through with its original level and reason, so a
member blocked by their age is never told they need to pay.

The safety decision is **passed in**, never recomputed. `can()` in
`src/lib/child-policy.ts` stays the single source of truth; the registry records
each feature's `safetyKey` explicitly (including explicit `null`), and a test
fails if a mapping is missing rather than silently skipping a safety check.

Step 3 sits above step 4 on purpose: **Disabled beats Free Mode.** Disabling a
feature is an availability decision, not a pricing one, so Free Mode never
switches back on something an admin deliberately turned off.

### Opposite fail directions, both intentional

- **Payment fails open to free.** An unreadable or malformed settings row
  resolves to free. A settings blip must never paywall a member.
- **Safety fails closed.** `cohortAllowed` default-denies; an unknown cohort is
  treated as `teen_13_15`.

Composing them must never let the open direction leak into the safety leg.

---

## 4. Where it is enforced

- **Client** — `useFeatureAccess()` / `useEntitlements()`. Display only.
- **Server** — `loadMonetizationConfig()` (30s cache, per isolate), consulted by
  the AI gate, `createCheckoutSession` and the sitemap. This is the authority.
- **Database** — `public.monetization_free_mode()`, consulted by
  `public.has_entitlement`.

In the AI gate the monetization check sits at step **(c2)**: after the feature
flag, child lock, consent and cohort checks, and before quota — so pricing can
never be what admits a member, and a denied member never consumes a quota
reservation.

---

## 5. Security

- `app_settings` grants `anon` and `authenticated` **SELECT only**, and has no
  INSERT/UPDATE policy. A regular user cannot write a monetization flag even
  with a forged request — it fails at the grant, before RLS is consulted.
- The only write path is `superadminSetSetting` → `assertSuperadmin` → service
  role, audit-logged to `admin_audit_log` with an optional reason.
- Client settings are never trusted for authorization. The server re-reads the
  config on every gated call.
- A fabricated entitlement state cannot unlock a `disabled` feature, and no
  malformed config resolves to "charging" — both asserted in
  `can-access.test.ts`.

---

## 6. Subscriptions & Stripe

- **Nobody is auto-cancelled.** Existing records are untouched.
- The billing webhook keeps recording subscription state, so re-enabling is
  seamless.
- **Manage billing & cancel** stays on `/plans` for anyone with a subscription.
  It uses `getBillingEnvironment()`, not `getStripeEnvironment()`, because the
  latter throws when the build has no publishable key — which would strand a
  subscriber with no way to cancel.
- `createCheckoutSession` refuses server-side while Free Mode is on.
- **Stripe status in this build:** `VITE_PAYMENTS_CLIENT_TOKEN` is commented out
  in `.env.production`, so checkout cannot open at all. That is an environment
  fact, not a product guarantee — Free Mode is the authoritative switch and does
  not depend on it.

---

## 7. Turning monetization on (§14 staging)

**Stage 1 — now.** Free Mode ON, everything else OFF.

**Stage 2 — controlled.** In the panel: set the features you want to charge for
to **Premium**, switch on `subscriptionsEnabled`, `paymentsEnabled`,
`premiumFeaturesEnabled`, `checkoutEnabled`, then turn **Free Mode off** — which
requires typing `MONETIZE` and giving a reason, and the dialog lists exactly
which features are about to start being enforced. Set
`VITE_PAYMENTS_CLIENT_TOKEN` if this build still has no Stripe key.

**Stage 3 — other models.** Not built, but the architecture takes them without
restructuring: `FeatureAccessMode` is a union (a new mode is one member plus one
branch), and step 7 of `canAccessFeature` is the single place an entitlement
becomes a yes/no — a credit balance, promo or admin grant plugs in there and
inherits the safety ordering. `team_pro` and `org_pro` already exist as
entitlements.

Members see changes within about five minutes (the client config's `staleTime`),
or immediately on a hard reload.

---

## 8. Things you should know before switching monetization on

### The plans advertise features that were never built

Audited against the code. If monetization is switched on as-is, these are sold
but do not exist:

| Plan | Claim | Reality |
| --- | --- | --- |
| ballaCity+ | "Advanced discovery filters" | Filters exist, but there is no advanced/basic split |
| ballaCity+ | "Member badge on your profile" | No such badge — `BADGES` is reputation only |
| ballaCity+ | "Advanced stats & availability" | Stats and availability exist, ungated, with no tiers |
| ballaCity+ | "Recruiting visibility" | Marketing copy only |
| Host Pro | "Unlimited game listings" | No listing cap exists to lift |
| Host Pro | "Automatic payment reminders" | Not implemented |
| Host Pro | "Featured placement" | Not implemented |
| Team | "Unlimited reels for 10 players" | No seat concept anywhere |
| Team | "Captain controls" | `captain` is absent from `MANAGER_ROLES`/`ROLE_ADMIN_ROLES`, so it grants nothing over `player` |
| Org | "Up to 25 players" | No seat concept |
| Org | "Priority support" | Single support channel |

The ballaCity+ list has been trimmed to the claims that are true. The rest are
left in place but flagged here: **fix the feature or drop the claim before
selling.** Free mode makes this harmless today — nobody pays, and `/plans` shows
no prices — but it renders the union of every product's features, so an unbuilt
claim would be promised to every member.

### The free reel allowance has never worked

`highlight_reels.used_free` and `free_reels_used()` exist, and `useSubscription`
reads them — but **nothing in `src/` ever writes `used_free = true`**. The
"N of 3 used" counter has always been display-only; the 3-reel limit never
stopped anyone. Re-enabling billing without fixing this means ballaCity+ gates
nothing.

### Five feature flags are write-only

`maintenance_mode`, `signups_enabled`, `games_creation_enabled`, `reels_enabled`
and `announcement_banner` are seeded in `app_settings` and editable in
SuperAdmin → Ops, but a full-text search of `src/` finds **no readers**. Nothing
obeys them. Out of scope for this work; worth a follow-up.

### Why there is no `platform_settings` table

`app_settings` already provides `key`, `value`, `description`, `updated_by` and
`updated_at`, plus `is_public`, with RLS, an audit trail and a superadmin-only
write path. A second settings table would split configuration across two places
and duplicate the security model.

---

## 9. What free mode deliberately does not touch

- **Player→host game fees.** Players pay hosts directly in Venmo / Zelle / Cash
  App / PayPal or cash; ballaCity never holds those funds. A host charging for a
  court booking is core functionality, not a ballaCity paywall. See
  `docs/payment-architecture-audit.md`.
- **Age, youth, guardian and child-safety gates.** Safety, not pricing.
- **AI quotas.** Per-tier daily/monthly caps still apply as a cost ceiling.
  "Free" is not "uncapped" — tune `freeModeAiTier` or `ai_limits`.
- **Existing subscriptions**, the billing webhook, and RLS.

---

## 10. Testing

**Automated and passing** (`bunx vitest run`):

- `can-access.test.ts` — the decision matrix. Adult under every toggle
  combination; **minor and guardian denials driven by real `child-policy`
  decisions, asserted to survive Free Mode with their safety level intact**;
  suspended accounts; Disabled beating Free Mode; fabricated entitlements;
  registry integrity (moderation never configurable, always-free never priced,
  every safety mapping explicit); staged monetization transitions.
- `access.test.ts` — free mode grants everything; re-enabling restores gating;
  free mode off alone still charges nobody.
- `config.test.ts` — override parsing, legacy `billingEnabled` translation,
  malformed input never resolving to "charging".
- `monetization-guards.test.ts` — ships free, every paid surface ships off, the
  paid catalog stays intact.
- `gate.test.ts` — AI tier follows the switch; safety ordering unchanged.

**Committed but needs a live project** — `e2e/free-mode-user-journey.spec.ts`
and `e2e/free-mode-superadmin.spec.ts` cover the §17 adult, minor and SuperAdmin
journeys. Run with `bun run test:e2e`. The superadmin spec needs a fixture
account holding the `superadmin` role; set `E2E_SUPERADMIN_ACCOUNT` to its
fixture key. Both skip cleanly without credentials.
