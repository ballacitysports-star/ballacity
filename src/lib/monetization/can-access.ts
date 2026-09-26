/**
 * "Can this member use this feature?" — the one function that composes safety
 * and payment.
 *
 * The ordering here is the whole point, and it is not negotiable:
 *
 *   1. account status   ─┐
 *   2. safety            ├─ never bypassable
 *   3. feature disabled ─┘
 *   4. free mode        ─┐
 *   5. premium off       ├─ payment; free mode reaches only these
 *   6. feature is free   │
 *   7. entitlement held ─┘
 *
 * Free mode can therefore only ever turn a *payment* denial into an allow. It
 * structurally cannot reach steps 1–3, so no monetization setting — and no
 * malformed settings row — can widen an age, guardian, consent, moderation or
 * suspension restriction.
 *
 * The safety decision is passed in, never recomputed. `can()` in
 * `@/lib/child-policy` stays the single source of truth for who is allowed what;
 * duplicating any part of it here would be a second, drifting copy of child
 * safety policy.
 */

import { DEFAULT_MONETIZATION_CONFIG, type MonetizationConfig } from "./config";
import { hasEntitlement, type EntitlementState } from "./entitlements";
import { featureFor, isConfigurable, type MonetizableFeature } from "./features";
import type { FeatureDecision, PermissionLevel } from "@/lib/child-policy";

/**
 * Safety levels plus the two a billing decision can produce. Extending rather
 * than editing `PermissionLevel` keeps payment vocabulary out of the child
 * safety module.
 */
export type AccessLevel = PermissionLevel | "payment_required" | "feature_disabled";

export type AccessDecision = {
  allowed: boolean;
  level: AccessLevel;
  reason: string | null;
};

const ALLOW: AccessDecision = { allowed: true, level: "allowed", reason: null };

export type CanAccessInput = {
  feature: string;
  config?: MonetizationConfig;
  entitlements?: EntitlementState;
  /**
   * The result of the existing safety decider — `can(...)` from child-policy or
   * one of its adapters (`hostingFeatureDecision`, `paymentsFeatureDecision`).
   * Omit only when the caller has genuinely established there is no safety
   * dimension; omitting it does NOT mean "allowed", it means "not evaluated
   * here", and the server path resolves it itself.
   */
  safety?: FeatureDecision | null;
  /**
   * From `public.platform_status(user)`. Anything other than "active" denies —
   * that RPC already folds suspension, age verification and consent together
   * and checks suspension first.
   */
  platformStatus?: string | null;
};

/** The pricing currently in force for one feature. */
export function featureMode(
  feature: MonetizableFeature,
  config: MonetizationConfig,
): "free" | "premium" | "disabled" {
  // Only gateable features may carry a setting at all; always-free and safety
  // features ignore whatever a malformed row claims about them.
  if (!isConfigurable(feature)) return "free";
  return config.access?.featureAccess?.[feature.key] ?? "free";
}

export function canAccessFeature(input: CanAccessInput): AccessDecision {
  const config = input.config ?? DEFAULT_MONETIZATION_CONFIG;
  const access = config.access ?? DEFAULT_MONETIZATION_CONFIG.access;

  // 1. Account status.
  if (input.platformStatus && input.platformStatus !== "active") {
    return {
      allowed: false,
      level: "blocked",
      reason: reasonForStatus(input.platformStatus),
    };
  }

  // 2. Safety. Passed straight through so the caller sees the real level and
  //    reason, not a billing-flavoured paraphrase of it.
  if (input.safety && !input.safety.allowed) {
    return {
      allowed: false,
      level: input.safety.level,
      reason: input.safety.reason,
    };
  }

  const feature = featureFor(input.feature);
  // An unknown key is not a licence to charge: it is free, and the registry
  // test is what catches the missing entry.
  if (!feature) return ALLOW;

  const mode = featureMode(feature, config);

  // 3. Switched off by an admin. Above free mode deliberately: "disabled" is an
  //    availability decision, not a pricing one, so free mode must not re-enable
  //    something that was turned off on purpose.
  if (mode === "disabled") {
    return {
      allowed: false,
      level: "feature_disabled",
      reason: "This feature isn't available right now.",
    };
  }

  // 4. Free mode.
  if (access.platformFreeMode) return ALLOW;

  // 5. Premium enforcement switched off entirely.
  if (!access.premiumFeaturesEnabled) return ALLOW;

  // 6. Priced as free.
  if (mode === "free") return ALLOW;

  // 7. Priced as premium — the only step that consults what was bought, and the
  //    single place a future access model (credits, promos, admin grants) plugs
  //    in without touching the ordering above.
  const held = input.entitlements ? hasEntitlement(input.entitlements, feature.entitlement) : false;
  return held
    ? ALLOW
    : {
        allowed: false,
        level: "payment_required",
        reason: `${feature.label} needs a subscription.`,
      };
}

function reasonForStatus(status: string): string {
  switch (status) {
    case "suspended":
      return "This account is suspended.";
    case "no_account":
      return "Sign in to use this feature.";
    default:
      // Age verification / parental consent states. Kept vague on purpose: the
      // dedicated consent screens explain the specifics.
      return "This account needs to finish setup before using this feature.";
  }
}
