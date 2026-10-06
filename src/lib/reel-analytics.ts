/**
 * Pro Analytics for highlight reels: 0–100 ratings, timestamped biomechanics
 * cues, a playstyle archetype with pro style comps, and a scout report.
 *
 * Pure module: the pipeline uses it to normalize model output before storing
 * `highlight_reels.ai_advanced_analytics`, and the Reel Studio / Reel Coach use
 * the same types to read it, so both sides agree on one shape.
 *
 * Everything here is defensive: junk from the model is clamped or dropped, never
 * stored as-is.
 */

import type { AgeCohort } from "@/lib/child-policy";

export const ANALYTICS_RATING_KEYS = [
  "overall",
  "mechanics",
  "explosiveness",
  "iq",
  "execution",
] as const;
export type AnalyticsRatingKey = (typeof ANALYTICS_RATING_KEYS)[number];

export const ANALYTICS_RATING_LABELS: Record<AnalyticsRatingKey, string> = {
  overall: "Overall impact",
  mechanics: "Mechanics & technique",
  explosiveness: "Explosiveness & speed",
  iq: "Tactical IQ",
  execution: "Execution",
};

export const RECRUITING_TIERS = [
  "Developing",
  "High School JV",
  "High School Varsity",
  "Club Elite",
  "College Prospect",
] as const;
export type RecruitingTier = (typeof RECRUITING_TIERS)[number];

export type BiomechanicsCue = {
  /** Seconds from the clip start; the Studio seeks the player here. */
  t: number;
  /** Kinetic-chain area, e.g. "Base", "Hips", "Release", "Follow-through". */
  area: string;
  cue: string;
  kind: "strength" | "fix";
};

export type ProComp = {
  name: string;
  /** 0–100 resemblance of movement pattern / habits — a style match, not a talent rating. */
  match: number;
  why: string;
};

export type ScoutReport = {
  tier: RecruitingTier;
  strengths: string[];
  drills: string[];
  quote: string;
};

export type AdvancedAnalytics = {
  version: 1;
  sport: string | null;
  ratings: Record<AnalyticsRatingKey, number>;
  biomechanics: BiomechanicsCue[];
  archetype: string | null;
  comps: ProComp[];
  /** Withheld for children under 13 and unknown ages. */
  scout: ScoutReport | null;
  /** How much the footage supports these grades (angle, distance, length). */
  confidence: string;
  model: string | null;
  generated_at: string;
};

/**
 * Children under 13 (and accounts whose age is unknown) get development
 * feedback only — no recruiting tier, scout quote, or comparisons to named
 * adult professionals.
 */
export function analyticsAudience(cohort: AgeCohort | null | undefined): "full" | "development" {
  return cohort === "adult" || cohort === "teen_16_17" || cohort === "teen_13_15"
    ? "full"
    : "development";
}

function str(v: unknown, max: number): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "";
}

function score(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function strList(v: unknown, max: number, len: number): string[] {
  return Array.isArray(v)
    ? v
        .map((x) => str(x, len))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

/** Accepts seconds (2.5) or clock strings ("0:02", "1:05.5"). */
export function parseCueTime(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  const clock = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const n = Number(s.replace(/s$/i, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Normalizes raw model JSON into `AdvancedAnalytics`, or null when the model
 * returned nothing usable (no ratings at all).
 */
export function normalizeAdvancedAnalytics(
  raw: unknown,
  opts: {
    cohort?: AgeCohort | null;
    duration?: number | null;
    sport?: string | null;
    model?: string | null;
    now?: Date;
  } = {},
): AdvancedAnalytics | null {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ratingsSrc =
    src.ratings && typeof src.ratings === "object" ? (src.ratings as Record<string, unknown>) : {};

  const partial: Partial<Record<AnalyticsRatingKey, number>> = {};
  for (const key of ANALYTICS_RATING_KEYS) {
    const v = score(ratingsSrc[key]);
    if (v != null) partial[key] = v;
  }
  const sub = (["mechanics", "explosiveness", "iq", "execution"] as const)
    .map((k) => partial[k])
    .filter((v): v is number => v != null);
  if (sub.length === 0 && partial.overall == null) return null;
  const mean = sub.length ? Math.round(sub.reduce((a, b) => a + b, 0) / sub.length) : 0;
  const ratings = {} as Record<AnalyticsRatingKey, number>;
  for (const key of ANALYTICS_RATING_KEYS) {
    ratings[key] = partial[key] ?? (key === "overall" ? mean : (partial.overall ?? mean));
  }

  const cap = opts.duration && opts.duration > 0 ? opts.duration : Infinity;
  const biomechanics: BiomechanicsCue[] = Array.isArray(src.biomechanics)
    ? src.biomechanics
        .map((c: Record<string, unknown> | null) => {
          const t = parseCueTime(c?.t ?? c?.timestamp ?? c?.at);
          return {
            t: t == null ? NaN : Math.round(Math.min(cap, t) * 100) / 100,
            area: str(c?.area, 32) || "Form",
            cue: str(c?.cue ?? c?.note, 200),
            kind: c?.kind === "strength" ? ("strength" as const) : ("fix" as const),
          };
        })
        .filter((c: BiomechanicsCue) => Number.isFinite(c.t) && c.cue.length > 0)
        .slice(0, 8)
        .sort((a: BiomechanicsCue, b: BiomechanicsCue) => a.t - b.t)
    : [];

  const full = analyticsAudience(opts.cohort) === "full";

  const comps: ProComp[] =
    full && Array.isArray(src.comps)
      ? src.comps
          .map((c: Record<string, unknown> | null) => ({
            name: str(c?.name, 60),
            match: score(c?.match ?? c?.similarity) ?? 0,
            why: str(c?.why, 200),
          }))
          .filter((c: ProComp) => c.name.length > 0 && c.match > 0)
          .slice(0, 2)
      : [];

  let scout: ScoutReport | null = null;
  const s = src.scout && typeof src.scout === "object" ? (src.scout as Record<string, unknown>) : null;
  if (full && s) {
    const tier = RECRUITING_TIERS.find((t) => t.toLowerCase() === str(s.tier, 40).toLowerCase());
    const quote = str(s.quote, 400);
    const strengths = strList(s.strengths, 3, 140);
    if (tier && (quote || strengths.length)) {
      scout = { tier, strengths, drills: strList(s.drills, 2, 200), quote };
    }
  }

  return {
    version: 1,
    sport: str(src.sport, 40) || opts.sport || null,
    ratings,
    biomechanics,
    archetype: str(src.archetype, 60) || null,
    comps,
    scout,
    confidence: str(src.confidence, 240),
    model: opts.model ?? null,
    generated_at: (opts.now ?? new Date()).toISOString(),
  };
}

/** Every AI-written string, for the safety check before the reel is shown. */
export function analyticsText(a: AdvancedAnalytics | null | undefined): string {
  if (!a) return "";
  return [
    a.archetype ?? "",
    ...a.biomechanics.map((c) => `${c.area}: ${c.cue}`),
    ...a.comps.map((c) => `${c.name} ${c.why}`),
    ...(a.scout ? [a.scout.quote, ...a.scout.strengths, ...a.scout.drills] : []),
    a.confidence,
  ]
    .filter(Boolean)
    .join("\n");
}

function clock(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Prompt grounding for Reel Coach, so the athlete can ask about their scores. */
export function analyticsGrounding(a: AdvancedAnalytics | null | undefined): string {
  if (!a) return "";
  return [
    `Pro analytics ratings (0-100): ${ANALYTICS_RATING_KEYS.map(
      (k) => `${ANALYTICS_RATING_LABELS[k]} ${a.ratings[k]}`,
    ).join(", ")}`,
    a.archetype ? `Playstyle archetype: ${a.archetype}` : "",
    a.biomechanics.length
      ? `Biomechanics cues: ${a.biomechanics
          .map((c) => `${clock(c.t)} [${c.kind}] ${c.area} — ${c.cue}`)
          .join("; ")}`
      : "",
    a.comps.length
      ? `Style comps: ${a.comps.map((c) => `${c.name} (${c.match}% style match)`).join(", ")}`
      : "",
    a.scout ? `Scout report — tier: ${a.scout.tier}; drills: ${a.scout.drills.join("; ")}` : "",
    a.confidence ? `Analytics confidence: ${a.confidence}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Plain-text scout card the athlete can paste to a coach or profile. */
export function scoutCardText(a: AdvancedAnalytics, title: string): string {
  return [
    `${title} — ballaCity Pro Analytics`,
    `Overall ${a.ratings.overall}/100 · Mechanics ${a.ratings.mechanics} · Explosiveness ${a.ratings.explosiveness} · IQ ${a.ratings.iq} · Execution ${a.ratings.execution}`,
    a.archetype ? `Archetype: ${a.archetype}` : "",
    a.comps.length ? `Plays like: ${a.comps.map((c) => c.name).join(", ")}` : "",
    a.scout ? `Tier: ${a.scout.tier}` : "",
    a.scout?.strengths.length ? `Strengths: ${a.scout.strengths.join("; ")}` : "",
    a.scout?.quote ? `"${a.scout.quote}"` : "",
    "AI-generated from a single clip — an estimate, not an official evaluation.",
  ]
    .filter(Boolean)
    .join("\n");
}
