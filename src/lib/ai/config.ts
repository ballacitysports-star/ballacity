/**
 * Non-secret AI configuration: feature flags, per-tier limits, provider/model
 * names and price estimates.
 *
 * Every value lives in `app_settings` (`ai_features`, `ai_limits`,
 * `ai_provider`, `ai_pricing`) so a superadmin can change it without a deploy.
 * API keys are NEVER part of this config — they stay in the server environment.
 *
 * Parsing is defensive: junk in a settings row falls back to the built-in
 * default instead of breaking an AI feature.
 */

import { AGE_COHORTS, type AgeCohort } from "@/lib/child-policy";

/** Every AI capability the app can run. Adding one here is a compile-time contract. */
export const AI_FEATURES = [
  "reel_pipeline",
  "reel_coach",
  "reel_package",
  "reel_style",
  "review_insights",
  "review_assist",
  "text_moderation",
  "image_moderation",
  "background_remove",
  "image_generate",
  "image_enhance",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export function isAiFeature(v: unknown): v is AiFeature {
  return typeof v === "string" && (AI_FEATURES as readonly string[]).includes(v);
}

/** Tiers limits are keyed by. Resolved from the existing entitlement code. */
export const AI_TIERS = ["free", "premium", "team", "gym"] as const;
export type AiTier = (typeof AI_TIERS)[number];

export type FeatureFlag = {
  enabled: boolean;
  /**
   * Cohorts explicitly allowed to use this feature. A cohort that is not listed
   * is DENIED — minors never gain a feature by omission.
   */
  cohorts: AgeCohort[];
};

export type AiFeaturesConfig = {
  /** Global kill switch: true disables every AI feature at once. */
  killSwitch: boolean;
  features: Record<AiFeature, FeatureFlag>;
};

export type FeatureLimit = { daily: number; monthly: number };

export type TierLimits = {
  maxConcurrentJobs: number;
  maxVideoSeconds: number;
  maxResolution: number;
  maxUploadMb: number;
  maxProcessingSeconds: number;
  perFeature: Record<AiFeature, FeatureLimit>;
};

export type AiLimitsConfig = Record<AiTier, TierLimits>;

export type AiProviderConfig = {
  provider: string;
  textModel: string;
  visionModel: string;
  /** Multimodal model for the Pro Analytics synthesis (ratings, biomechanics, scout report). */
  analyticsModel: string;
  audioModel: string;
  moderationTextModel: string;
  moderationImageModel: string;
  imageModel: string;
};

export type AiPricingConfig = {
  /** Dollars-per-million-token estimates, in cents, keyed by model id. */
  models: Record<string, { inputCentsPerMTok: number; outputCentsPerMTok: number }>;
};

export type AiConfig = {
  features: AiFeaturesConfig;
  limits: AiLimitsConfig;
  provider: AiProviderConfig;
  pricing: AiPricingConfig;
};

const ADULT_ONLY: AgeCohort[] = ["adult"];
/** Everything a guardian-approved minor may use today (unchanged from current behavior). */
const REEL_COHORTS: AgeCohort[] = ["adult", "teen_16_17", "teen_13_15", "child_under_13"];
/** Safety scanning runs on the platform's behalf for every account. */
const ALL_COHORTS: AgeCohort[] = [...AGE_COHORTS];

export const DEFAULT_AI_FEATURES: AiFeaturesConfig = {
  killSwitch: false,
  features: {
    reel_pipeline: { enabled: true, cohorts: REEL_COHORTS },
    reel_coach: { enabled: true, cohorts: REEL_COHORTS },
    reel_package: { enabled: true, cohorts: REEL_COHORTS },
    reel_style: { enabled: true, cohorts: REEL_COHORTS },
    // Review analysis/summaries describe a person from what others wrote about them: adults only.
    review_insights: { enabled: true, cohorts: ADULT_ONLY },
    review_assist: { enabled: true, cohorts: ADULT_ONLY },
    text_moderation: { enabled: true, cohorts: ALL_COHORTS },
    image_moderation: { enabled: true, cohorts: ALL_COHORTS },
    background_remove: { enabled: true, cohorts: REEL_COHORTS },
    // Phase 4. Declared, disabled, and adult-only until a later phase configures cohorts.
    image_generate: { enabled: false, cohorts: ADULT_ONLY },
    image_enhance: { enabled: false, cohorts: ADULT_ONLY },
  },
};

function limitsFor(
  base: { concurrent: number; videoSeconds: number; uploadMb: number; processingSeconds: number },
  perFeature: Partial<Record<AiFeature, FeatureLimit>>,
): TierLimits {
  const fallback: FeatureLimit = { daily: 0, monthly: 0 };
  const filled = {} as Record<AiFeature, FeatureLimit>;
  for (const f of AI_FEATURES) filled[f] = perFeature[f] ?? fallback;
  return {
    maxConcurrentJobs: base.concurrent,
    maxVideoSeconds: base.videoSeconds,
    maxResolution: 1920,
    maxUploadMb: base.uploadMb,
    maxProcessingSeconds: base.processingSeconds,
    perFeature: filled,
  };
}

/** Safety scanning is platform work, never rationed by the member's plan. */
const UNMETERED: FeatureLimit = { daily: 100000, monthly: 1000000 };

export const DEFAULT_AI_LIMITS: AiLimitsConfig = {
  free: limitsFor(
    { concurrent: 3, videoSeconds: 150, uploadMb: 200, processingSeconds: 600 },
    {
      reel_pipeline: { daily: 10, monthly: 60 },
      reel_coach: { daily: 40, monthly: 400 },
      review_insights: { daily: 20, monthly: 200 },
      review_assist: { daily: 10, monthly: 100 },
      reel_package: { daily: 20, monthly: 150 },
      reel_style: { daily: 10, monthly: 60 },
      background_remove: { daily: 20, monthly: 100 },
      text_moderation: UNMETERED,
      image_moderation: UNMETERED,
    },
  ),
  premium: limitsFor(
    { concurrent: 3, videoSeconds: 150, uploadMb: 200, processingSeconds: 600 },
    {
      reel_pipeline: { daily: 40, monthly: 400 },
      reel_coach: { daily: 200, monthly: 2000 },
      review_insights: { daily: 60, monthly: 600 },
      review_assist: { daily: 40, monthly: 400 },
      reel_package: { daily: 100, monthly: 1000 },
      reel_style: { daily: 40, monthly: 400 },
      background_remove: { daily: 60, monthly: 600 },
      text_moderation: UNMETERED,
      image_moderation: UNMETERED,
    },
  ),
  team: limitsFor(
    { concurrent: 3, videoSeconds: 150, uploadMb: 200, processingSeconds: 600 },
    {
      reel_pipeline: { daily: 80, monthly: 800 },
      reel_coach: { daily: 300, monthly: 3000 },
      review_insights: { daily: 100, monthly: 1000 },
      review_assist: { daily: 60, monthly: 600 },
      reel_package: { daily: 150, monthly: 1500 },
      reel_style: { daily: 80, monthly: 800 },
      background_remove: { daily: 100, monthly: 1000 },
      text_moderation: UNMETERED,
      image_moderation: UNMETERED,
    },
  ),
  gym: limitsFor(
    { concurrent: 3, videoSeconds: 150, uploadMb: 200, processingSeconds: 600 },
    {
      reel_pipeline: { daily: 120, monthly: 1200 },
      reel_coach: { daily: 400, monthly: 4000 },
      review_insights: { daily: 150, monthly: 1500 },
      review_assist: { daily: 80, monthly: 800 },
      reel_package: { daily: 200, monthly: 2000 },
      reel_style: { daily: 120, monthly: 1200 },
      background_remove: { daily: 150, monthly: 1500 },
      text_moderation: UNMETERED,
      image_moderation: UNMETERED,
    },
  ),
};

export const DEFAULT_AI_PROVIDER: AiProviderConfig = {
  provider: "lovable",
  textModel: "google/gemini-3-flash-preview",
  visionModel: "google/gemini-3-flash-preview",
  analyticsModel: "google/gemini-2.5-pro",
  audioModel: "google/gemini-3-flash-preview",
  moderationTextModel: "google/gemini-2.5-flash-lite",
  moderationImageModel: "google/gemini-2.5-flash-lite",
  imageModel: "google/gemini-2.5-flash-image",
};

export const DEFAULT_AI_PRICING: AiPricingConfig = {
  models: {
    "google/gemini-3-flash-preview": { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
    "google/gemini-2.5-pro": { inputCentsPerMTok: 125, outputCentsPerMTok: 1000 },
    "google/gemini-2.5-flash-lite": { inputCentsPerMTok: 10, outputCentsPerMTok: 40 },
    "google/gemini-2.5-flash-image": { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
  },
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  features: DEFAULT_AI_FEATURES,
  limits: DEFAULT_AI_LIMITS,
  provider: DEFAULT_AI_PROVIDER,
  pricing: DEFAULT_AI_PRICING,
};

/* ------------------------------- parsing -------------------------------- */

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}
function num(v: unknown, d: number, min = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : d;
}
function cohorts(v: unknown, d: AgeCohort[]): AgeCohort[] {
  if (!Array.isArray(v)) return d;
  const list = v.filter((c): c is AgeCohort =>
    (AGE_COHORTS as readonly string[]).includes(c as string),
  );
  return list;
}

export function parseAiFeatures(raw: unknown): AiFeaturesConfig {
  const src = obj(raw);
  const featureSrc = obj(src["features"]);
  const features = {} as Record<AiFeature, FeatureFlag>;
  for (const key of AI_FEATURES) {
    const d = DEFAULT_AI_FEATURES.features[key];
    const f = obj(featureSrc[key]);
    features[key] = {
      enabled: bool(f["enabled"], d.enabled),
      cohorts: "cohorts" in f ? cohorts(f["cohorts"], d.cohorts) : d.cohorts,
    };
  }
  return { killSwitch: bool(src["killSwitch"], DEFAULT_AI_FEATURES.killSwitch), features };
}

function parseTierLimits(raw: unknown, d: TierLimits): TierLimits {
  const src = obj(raw);
  const perSrc = obj(src["perFeature"]);
  const perFeature = {} as Record<AiFeature, FeatureLimit>;
  for (const key of AI_FEATURES) {
    const f = obj(perSrc[key]);
    perFeature[key] = {
      daily: num(f["daily"], d.perFeature[key].daily),
      monthly: num(f["monthly"], d.perFeature[key].monthly),
    };
  }
  return {
    maxConcurrentJobs: num(src["maxConcurrentJobs"], d.maxConcurrentJobs, 1),
    maxVideoSeconds: num(src["maxVideoSeconds"], d.maxVideoSeconds, 1),
    maxResolution: num(src["maxResolution"], d.maxResolution, 240),
    maxUploadMb: num(src["maxUploadMb"], d.maxUploadMb, 1),
    maxProcessingSeconds: num(src["maxProcessingSeconds"], d.maxProcessingSeconds, 30),
    perFeature,
  };
}

export function parseAiLimits(raw: unknown): AiLimitsConfig {
  const src = obj(raw);
  const out = {} as AiLimitsConfig;
  for (const tier of AI_TIERS) {
    out[tier] = parseTierLimits(src[tier], DEFAULT_AI_LIMITS[tier]);
  }
  return out;
}

/** Model/provider names only. Anything key-shaped in the row is ignored outright. */
export function parseAiProvider(raw: unknown): AiProviderConfig {
  const src = obj(raw);
  const str = (k: keyof AiProviderConfig) => {
    const v = src[k];
    return typeof v === "string" && v.trim().length > 0 && v.length <= 120
      ? v.trim()
      : DEFAULT_AI_PROVIDER[k];
  };
  return {
    provider: str("provider"),
    textModel: str("textModel"),
    visionModel: str("visionModel"),
    analyticsModel: str("analyticsModel"),
    audioModel: str("audioModel"),
    moderationTextModel: str("moderationTextModel"),
    moderationImageModel: str("moderationImageModel"),
    imageModel: str("imageModel"),
  };
}

export function parseAiPricing(raw: unknown): AiPricingConfig {
  const src = obj(obj(raw)["models"]);
  const models: AiPricingConfig["models"] = { ...DEFAULT_AI_PRICING.models };
  for (const [model, value] of Object.entries(src)) {
    const v = obj(value);
    models[model] = {
      inputCentsPerMTok: num(v["inputCentsPerMTok"], 0),
      outputCentsPerMTok: num(v["outputCentsPerMTok"], 0),
    };
  }
  return { models };
}

export function parseAiConfig(rows: {
  ai_features?: unknown;
  ai_limits?: unknown;
  ai_provider?: unknown;
  ai_pricing?: unknown;
}): AiConfig {
  return {
    features: parseAiFeatures(rows.ai_features),
    limits: parseAiLimits(rows.ai_limits),
    provider: parseAiProvider(rows.ai_provider),
    pricing: parseAiPricing(rows.ai_pricing),
  };
}

/** Cost estimate in cents. Estimates only — never billed from. */
export function estimateCostCents(
  pricing: AiPricingConfig,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = pricing.models[model];
  if (!p) return 0;
  const cents =
    (inputTokens / 1_000_000) * p.inputCentsPerMTok +
    (outputTokens / 1_000_000) * p.outputCentsPerMTok;
  return Math.round(cents * 10000) / 10000;
}

/** True when the cohort is explicitly allowed. Absence is a denial, by design. */
export function cohortAllowed(flag: FeatureFlag, cohort: AgeCohort): boolean {
  return flag.cohorts.includes(cohort);
}
