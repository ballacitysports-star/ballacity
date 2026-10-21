/**
 * Pure helpers behind the superadmin AI controls panel: labels, which knobs the
 * gate actually enforces, and the one-click recommended preset.
 *
 * Kept free of React so the preset math is unit-tested on its own.
 */

import {
  AI_TIERS,
  type AiFeature,
  type AiLimitsConfig,
  type AiTier,
  type TierLimits,
} from "./config";

export const AI_TIER_LABELS: Record<AiTier, string> = {
  free: "Free",
  premium: "BallaCity+",
  team: "Team",
  gym: "Org / Gym",
};

/**
 * Safety scanning runs on the platform's behalf. The gate never meters it and
 * the kill switch never stops it, so the panel shows it as locked on.
 */
export const PLATFORM_AI_FEATURES: readonly AiFeature[] = ["text_moderation", "image_moderation"];

export const AI_FEATURE_META: Record<AiFeature, { label: string; description: string }> = {
  reel_pipeline: {
    label: "Highlight reels",
    description: "Builds a highlight reel from an upload, including Pro Analytics grading.",
  },
  reel_coach: { label: "Reel Coach", description: "Chat-style coaching questions about a reel." },
  reel_package: { label: "Reel packaging", description: "Titles, captions and share copy." },
  reel_style: { label: "Reel restyle", description: "Re-cuts an existing reel in a new style." },
  review_insights: {
    label: "Review insights",
    description: "Summarises what others wrote about a member.",
  },
  review_assist: { label: "Review assist", description: "Helps a member write a review." },
  post_assist: { label: "Post assist", description: "Drafts a team post from a member's notes." },
  content_studio: {
    label: "Content studio",
    description:
      "Drafts posts for the official BallaCity Facebook Page from a staff-reviewed source. Every draft needs a superadmin approval before it can be published.",
  },
  skill_assessment: {
    label: "Skill assessment",
    description: "AI-assisted skill ratings from peer input.",
  },
  text_moderation: { label: "Text moderation", description: "Safety scan of user text." },
  image_moderation: { label: "Image moderation", description: "Safety scan of user images." },
  background_remove: { label: "Background removal", description: "Cut-out for profile images." },
  image_generate: { label: "Image generation", description: "Not launched yet." },
  image_enhance: { label: "Image enhance", description: "Not launched yet." },
};

/** Per-tier knobs, and whether anything in the server reads them today. */
export const TIER_LIMIT_FIELDS: {
  key: Exclude<keyof TierLimits, "perFeature">;
  label: string;
  unit: string;
  min: number;
  enforced: boolean;
}[] = [
  { key: "maxConcurrentJobs", label: "Concurrent jobs", unit: "jobs", min: 1, enforced: true },
  { key: "maxVideoSeconds", label: "Max clip length", unit: "sec", min: 1, enforced: true },
  { key: "maxUploadMb", label: "Max upload size", unit: "MB", min: 1, enforced: true },
  { key: "maxResolution", label: "Max resolution", unit: "px", min: 240, enforced: true },
  {
    key: "maxProcessingSeconds",
    label: "Max processing time",
    unit: "sec",
    min: 30,
    enforced: true,
  },
];

type TierPreset = {
  maxConcurrentJobs: number;
  maxVideoSeconds: number;
  maxUploadMb: number;
  reelsDaily: number;
  reelsMonthly: number;
};

/**
 * Recommended fair-use tiers. Only the fields named here change; every other
 * per-feature quota keeps its current value.
 */
export const RECOMMENDED_TIER_PRESET: Record<AiTier, TierPreset> = {
  free: {
    maxConcurrentJobs: 1,
    maxVideoSeconds: 60,
    maxUploadMb: 100,
    reelsDaily: 3,
    reelsMonthly: 3,
  },
  premium: {
    maxConcurrentJobs: 2,
    maxVideoSeconds: 150,
    maxUploadMb: 200,
    reelsDaily: 10,
    reelsMonthly: 40,
  },
  team: {
    maxConcurrentJobs: 3,
    maxVideoSeconds: 240,
    maxUploadMb: 350,
    reelsDaily: 30,
    reelsMonthly: 150,
  },
  gym: {
    maxConcurrentJobs: 5,
    maxVideoSeconds: 300,
    maxUploadMb: 500,
    reelsDaily: 60,
    reelsMonthly: 400,
  },
};

export function applyRecommendedPreset(current: AiLimitsConfig): AiLimitsConfig {
  const out = {} as AiLimitsConfig;
  for (const tier of AI_TIERS) {
    const p = RECOMMENDED_TIER_PRESET[tier];
    const t = current[tier];
    out[tier] = {
      ...t,
      maxConcurrentJobs: p.maxConcurrentJobs,
      maxVideoSeconds: p.maxVideoSeconds,
      maxUploadMb: p.maxUploadMb,
      perFeature: {
        ...t.perFeature,
        reel_pipeline: { daily: p.reelsDaily, monthly: p.reelsMonthly },
      },
    };
  }
  return out;
}

/**
 * Problems the gate would silently paper over. The parser falls back to the
 * default for a value below its minimum, so saving one would not do what the
 * admin typed; the panel blocks the save and says why instead.
 */
export function limitsProblems(limits: AiLimitsConfig): string[] {
  const problems: string[] = [];
  for (const tier of AI_TIERS) {
    const t = limits[tier];
    for (const f of TIER_LIMIT_FIELDS) {
      const v = t[f.key];
      if (!Number.isFinite(v) || v < f.min) {
        problems.push(`${AI_TIER_LABELS[tier]}: ${f.label} must be at least ${f.min}.`);
      }
    }
    for (const [feature, q] of Object.entries(t.perFeature) as [
      AiFeature,
      (typeof t.perFeature)[AiFeature],
    ][]) {
      if (PLATFORM_AI_FEATURES.includes(feature)) continue;
      const name = AI_FEATURE_META[feature].label;
      if (
        !Number.isFinite(q.daily) ||
        q.daily < 0 ||
        !Number.isFinite(q.monthly) ||
        q.monthly < 0
      ) {
        problems.push(`${AI_TIER_LABELS[tier]}: ${name} quotas cannot be negative.`);
      } else if (q.daily > q.monthly) {
        problems.push(`${AI_TIER_LABELS[tier]}: ${name} daily cap is above its monthly cap.`);
      }
    }
  }
  return problems;
}
