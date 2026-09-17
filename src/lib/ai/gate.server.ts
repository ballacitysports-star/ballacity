/**
 * The single gate every AI server function passes through.
 *
 * Order is fixed and non-negotiable:
 *   a) feature flag / global kill switch (`app_settings.ai_features`)
 *   b) consent + child policy (the existing `ai_analysis_allowed` and
 *      `child_features_locked` database functions stay authoritative)
 *   c) cohort allowance — a cohort not explicitly listed for the feature is
 *      DENIED, so minors never gain a feature by omission
 *   c2) monetization — only ever reached once every safety step above has
 *      passed, so pricing can never be what admits a member
 *   d) quota + concurrency, reserved atomically in the database
 *
 * Denials are typed (`AiError`), never generic.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AgeCohort } from "@/lib/child-policy";
import {
  EMPTY_ENTITLEMENTS,
  entitlementsFor,
  type SubscriptionLike,
} from "@/lib/monetization/entitlements";
import { resolveFeatureAccess } from "@/lib/monetization/access";
import { canAccessFeature } from "@/lib/monetization/can-access";
import { loadMonetizationConfig } from "@/lib/monetization/settings.server";
import {
  AI_TIERS,
  cohortAllowed,
  estimateCostCents,
  type AiConfig,
  type AiFeature,
  type AiTier,
  type TierLimits,
} from "./config";
import { AiError, toAiError } from "./errors";
import { createLovableGatewayProvider } from "./gateway.server";
import type { AiProvider, AiTokenUsage } from "./provider";
import { loadAiConfig } from "./settings.server";
import { addJobCost, recordUsage } from "./usage.server";

/**
 * Platform safety work. It runs on ballaCity's behalf for every account, so it
 * is not subject to member consent, cohort allowances or plan quotas — only to
 * the feature flag.
 */
const PLATFORM_FEATURES: ReadonlySet<AiFeature> = new Set(["text_moderation", "image_moderation"]);

export type AiGateContext = {
  /** Service-role client. Defaults to the generated admin client. */
  admin?: any;
  userId: string;
  relatedReelId?: string | null;
  inputSummary?: Record<string, unknown>;
};

export type AiSession = {
  admin: any;
  userId: string;
  feature: AiFeature;
  jobId: string | null;
  tier: AiTier;
  cohort: AgeCohort;
  limits: TierLimits;
  config: AiConfig;
  provider: AiProvider;
};

export async function resolveAiTier(admin: any, userId: string): Promise<AiTier> {
  try {
    const monetization = await loadMonetizationConfig(admin);
    const access = resolveFeatureAccess(monetization);

    // While ballaCity is free, nobody's tier depends on what they bought. The
    // quota itself still applies — it is a cost ceiling, not a paywall — so an
    // admin can dial the tier down without charging anyone.
    if (access.aiTierOverride && AI_TIERS.includes(access.aiTierOverride as AiTier)) {
      return access.aiTierOverride as AiTier;
    }

    const { data } = await admin
      .from("subscriptions")
      .select("status,price_id,tier,current_period_end")
      .eq("user_id", userId);
    const state = entitlementsFor((data ?? []) as SubscriptionLike[], Date.now(), monetization);
    if (state.entitlements.has("facility_pro") || state.entitlements.has("org_pro")) return "gym";
    if (state.entitlements.has("team_pro")) return "team";
    if (state.entitlements.has("player_plus") || state.entitlements.has("host_pro")) {
      return "premium";
    }
  } catch {
    /* fall through to free */
  }
  return "free";
}

/**
 * AI feature keys are the AI layer's own namespace; the monetization registry
 * has its own. Mapped explicitly rather than by convention so a renamed key is
 * a compile/test failure instead of a silently unpriced feature.
 */
const AI_FEATURE_TO_MONETIZABLE: Partial<Record<AiFeature, string>> = {
  reel_pipeline: "ai_reel_pipeline",
  reel_coach: "ai_reel_coach",
  reel_package: "ai_reel_package",
  reel_style: "ai_reel_style",
  background_remove: "ai_background_remove",
};

/** The member's real entitlements, for the monetization leg of the gate. */
async function entitlementStateFor(admin: Parameters<typeof resolveAiTier>[0], userId: string) {
  try {
    const { data } = await admin
      .from("subscriptions")
      .select("status,price_id,tier,current_period_end")
      .eq("user_id", userId);
    return entitlementsFor((data ?? []) as SubscriptionLike[]);
  } catch {
    return EMPTY_ENTITLEMENTS;
  }
}

async function cohortOf(admin: any, userId: string): Promise<AgeCohort> {
  try {
    const { data } = await admin.rpc("age_cohort_of", { _user: userId });
    const value = typeof data === "string" ? data : "unknown";
    return value as AgeCohort;
  } catch {
    return "unknown";
  }
}

function isMinorCohort(cohort: AgeCohort): boolean {
  return cohort === "child_under_13" || cohort === "teen_13_15" || cohort === "teen_16_17";
}

/** Runs the gate and, when allowed, returns a session with a reserved job row. */
export async function assertAiAllowed(
  ctx: AiGateContext,
  feature: AiFeature,
  units = 1,
): Promise<AiSession> {
  const admin = ctx.admin ?? supabaseAdmin;
  const config = await loadAiConfig(admin);
  const flag = config.features.features[feature];
  const platform = PLATFORM_FEATURES.has(feature);

  // (a) flags — safety scanning is exempt from the global kill switch, so
  // turning AI off to save money can never turn safety scanning off.
  if (!flag.enabled) throw new AiError("FEATURE_DISABLED");
  if (!platform && config.features.killSwitch) throw new AiError("FEATURE_DISABLED");

  const cohort = platform ? "adult" : await cohortOf(admin, ctx.userId);

  if (!platform) {
    // (b) consent + child policy — existing family architecture is authoritative
    const locked = await admin
      .rpc("child_features_locked", { _user: ctx.userId })
      .then((r: any) => r.data === true)
      .catch(() => false);
    if (locked) throw new AiError("PARENT_APPROVAL_REQUIRED");

    const consented = await admin
      .rpc("ai_analysis_allowed", { _user: ctx.userId })
      .then((r: any) => r.data === true)
      .catch(() => false);
    if (!consented) {
      throw new AiError(isMinorCohort(cohort) ? "PARENT_APPROVAL_REQUIRED" : "CONSENT_REQUIRED");
    }

    // (c) cohort allowance — default deny
    if (!cohortAllowed(flag, cohort)) {
      throw new AiError(
        isMinorCohort(cohort) || cohort === "unknown"
          ? "PARENT_APPROVAL_REQUIRED"
          : "FEATURE_DISABLED",
      );
    }

    // (c2) monetization — deliberately AFTER every safety check above, so a
    // pricing setting can never be the thing that lets a minor through, and
    // before quota so a denied member never consumes a reservation. Platform
    // safety features skip this entire block and are never priced.
    const monetization = await loadMonetizationConfig(admin);
    const decision = canAccessFeature({
      feature: AI_FEATURE_TO_MONETIZABLE[feature] ?? feature,
      config: monetization,
      entitlements: await entitlementStateFor(admin, ctx.userId),
    });
    if (!decision.allowed) {
      throw new AiError(
        decision.level === "payment_required" ? "SUBSCRIPTION_REQUIRED" : "FEATURE_DISABLED",
      );
    }
  }

  const tier = platform ? "free" : await resolveAiTier(admin, ctx.userId);
  const limits = config.limits[tier];
  const perFeature = limits.perFeature[feature];

  // Safety scanning is never rationed: no quota, no concurrency ceiling.
  if (platform) {
    return {
      admin,
      userId: ctx.userId,
      feature,
      jobId: null,
      tier,
      cohort,
      limits,
      config,
      provider: createLovableGatewayProvider(config.provider),
    };
  }

  // (d) quota + concurrency, reserved atomically
  const { data, error } = await admin.rpc("ai_reserve_quota", {
    _user_id: ctx.userId,
    _feature: feature,
    _units: Math.max(1, units),
    _daily_limit: perFeature.daily,
    _monthly_limit: perFeature.monthly,
    _max_concurrent: limits.maxConcurrentJobs,
    _input_summary: ctx.inputSummary ?? {},
    _related_reel_id: ctx.relatedReelId ?? null,
    _provider: config.provider.provider,
    _model: config.provider.textModel,
    _max_attempts: 3,
  });

  if (error) throw toAiError(error);

  const result = (data ?? {}) as {
    allowed?: boolean;
    reason?: string;
    job_id?: string;
  };

  if (!result.allowed) {
    await recordUsage(
      admin,
      { jobId: null, userId: ctx.userId, feature },
      {
        provider: config.provider.provider,
        model: config.provider.textModel,
        units,
        outcome: "quota_denied",
        config,
      },
    );
    throw new AiError(
      result.reason === "CONCURRENCY_LIMIT" ? "CONCURRENCY_LIMIT" : "QUOTA_EXCEEDED",
    );
  }

  return {
    admin,
    userId: ctx.userId,
    feature,
    jobId: result.job_id ?? null,
    tier,
    cohort,
    limits,
    config,
    provider: createLovableGatewayProvider(config.provider),
  };
}

/**
 * Wraps one provider call so usage, cost and failures are always recorded, and
 * so no raw provider error can escape the layer.
 */
export async function runAiCall<T extends { usage: AiTokenUsage; model: string }>(
  session: AiSession,
  fn: (provider: AiProvider) => Promise<T>,
): Promise<T> {
  try {
    const out = await fn(session.provider);
    await recordUsage(
      session.admin,
      { jobId: session.jobId, userId: session.userId, feature: session.feature },
      {
        provider: session.provider.name,
        model: out.model,
        usage: out.usage,
        outcome: "ok",
        config: session.config,
      },
    );
    await addJobCost(
      session.admin,
      session.jobId,
      estimateCostCents(
        session.config.pricing,
        out.model,
        out.usage.inputTokens,
        out.usage.outputTokens,
      ),
      session.provider.name,
      out.model,
    );
    return out;
  } catch (e) {
    const err = toAiError(e);
    await recordUsage(
      session.admin,
      { jobId: session.jobId, userId: session.userId, feature: session.feature },
      {
        provider: session.provider.name,
        model: session.config.provider.textModel,
        outcome: err.code === "MODERATION_BLOCKED" ? "blocked" : "error",
        config: session.config,
      },
    );
    throw err;
  }
}
