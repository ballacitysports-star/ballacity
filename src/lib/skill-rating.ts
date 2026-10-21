/**
 * Skill rating engine (rating system, phase 4). Pure and deterministic.
 *
 * Skill is a normal belief per player per sport on a 0–100 scale: a mean `mu`
 * and an uncertainty `sigma`. Every signal is an observation with its own noise;
 * they combine by precision weighting (a Kalman/Glicko-style Bayesian update),
 * so a self-chosen tier is just a loose starting point that peer votes and
 * video analysis tighten or move, in proportion to how reliable each is.
 *
 * Skill is deliberately kept apart from conduct reputation (see badges.ts):
 * nothing here reads reviews, and nothing in reputation reads this.
 */

import { GENERIC_SCALE, parseSkillTiers, scaleForSport, type SportScale } from "@/lib/sport-levels";
import type { Sport } from "@/lib/sample-data";

export const SKILL = {
  /** Where a player with no information starts, and how unsure that is. */
  priorMean: 50,
  priorSigma: 30,
  /** Observation noise (std-dev, in rating points) per signal type. */
  selfSigma: 22,
  peerSigma: 16,
  videoSigma: 15,
  /** How far a "below / above" vote moves the observation from the game's level. */
  peerStep: 14,
  /** Days for a signal's precision to halve. */
  halfLifeDays: 120,
  recencyFloor: 0.1,
  /** Thresholds on sigma for the status label. */
  establishedSigma: 9,
  developingSigma: 15,
  /** Interval half-width in sigmas (≈ 80% interval). */
  intervalZ: 1.28,
} as const;

export type SkillSignal =
  | { kind: "self"; value: number }
  | {
      kind: "peer";
      /** −1 below the game's level, 0 at it, +1 above it. */
      vote: -1 | 0 | 1;
      /** Average skill of the people in that game (0–100). */
      gameLevel: number;
      /** 0.5–1.2: how much to trust this voter. */
      weight: number;
      date: string;
    }
  | { kind: "video"; value: number; date: string };

export type SkillStatus = "provisional" | "developing" | "established";

export type SkillEstimate = {
  mu: number;
  sigma: number;
  low: number;
  high: number;
  status: SkillStatus;
  /** Share (0–1) of the posterior precision contributed by each signal type. */
  contributions: { self: number; peer: number; video: number };
  counts: { peer: number; video: number };
};

const DAY = 86_400_000;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

function recency(date: string, now: number): number {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return 1;
  const age = Math.max(0, (now - t) / DAY);
  return Math.max(SKILL.recencyFloor, Math.pow(0.5, age / SKILL.halfLifeDays));
}

export function estimateSkill(signals: SkillSignal[], now = Date.now()): SkillEstimate {
  const p0 = 1 / SKILL.priorSigma ** 2;
  let precision = p0;
  let weighted = p0 * SKILL.priorMean;
  const share = { self: 0, peer: 0, video: 0 };
  const counts = { peer: 0, video: 0 };

  const add = (kind: keyof typeof share, y: number, p: number) => {
    precision += p;
    weighted += p * y;
    share[kind] += p;
  };

  // Self-rating: the loosest signal, and it never decays (a stated level).
  const self = signals.find((s) => s.kind === "self");
  if (self && self.kind === "self") add("self", clamp(self.value), 1 / SKILL.selfSigma ** 2);

  for (const s of signals) {
    if (s.kind !== "peer") continue;
    counts.peer += 1;
    const y = clamp(s.gameLevel + s.vote * SKILL.peerStep);
    add("peer", y, (s.weight * recency(s.date, now)) / SKILL.peerSigma ** 2);
  }

  // Clips from the same player are correlated, so several count for more than
  // one but with sharply diminishing returns.
  const clips = signals.filter(
    (s): s is Extract<SkillSignal, { kind: "video" }> => s.kind === "video",
  );
  if (clips.length) {
    counts.video = clips.length;
    let sw = 0;
    let sy = 0;
    for (const c of clips) {
      const w = recency(c.date, now);
      sw += w;
      sy += w * clamp(c.value);
    }
    const y = sy / sw;
    const boost = Math.min(1.7, Math.sqrt(clips.length));
    add("video", y, (boost * (sw / clips.length)) / SKILL.videoSigma ** 2);
  }

  const mu = weighted / precision;
  const sigma = Math.sqrt(1 / precision);
  const evidence = precision - p0;
  const norm = (v: number) => (evidence > 0 ? v / evidence : 0);
  const status: SkillStatus =
    sigma <= SKILL.establishedSigma
      ? "established"
      : sigma <= SKILL.developingSigma
        ? "developing"
        : "provisional";
  return {
    mu: Math.round(mu * 10) / 10,
    sigma: Math.round(sigma * 10) / 10,
    low: Math.round(clamp(mu - SKILL.intervalZ * sigma)),
    high: Math.round(clamp(mu + SKILL.intervalZ * sigma)),
    status,
    contributions: { self: norm(share.self), peer: norm(share.peer), video: norm(share.video) },
    counts,
  };
}

// ---------------------------------------------------------------------------
// Mapping between a sport's own scale and 0–100
// ---------------------------------------------------------------------------

/** Tiers on the main ladder — submenu divisions (e.g. Little League ages) are excluded. */
function ladder(scale: SportScale): string[] {
  const hidden = new Set(Object.values(scale.submenus ?? {}).flat());
  return scale.tiers.filter((t) => !hidden.has(t));
}

function scaleFor(sport: string): SportScale {
  return scaleForSport(sport as Sport) ?? GENERIC_SCALE;
}

/** Position of a tier on the 0–100 scale (evenly spaced, 10…90), or null if unknown. */
export function tierToScore(sport: string, tier: string): number | null {
  const scale = scaleFor(sport);
  const rungs = ladder(scale);
  let i = rungs.indexOf(tier);
  if (i === -1) {
    // A submenu division belongs to its parent rung.
    const parent = Object.entries(scale.submenus ?? {}).find(([, kids]) => kids.includes(tier));
    if (parent) i = rungs.indexOf(parent[0]);
  }
  if (i === -1) return null;
  if (rungs.length === 1) return 50;
  return 10 + (80 * i) / (rungs.length - 1);
}

export function scoreToTier(sport: string, score: number): string {
  const rungs = ladder(scaleFor(sport));
  const i = Math.round(((clamp(score) - 10) / 80) * (rungs.length - 1));
  return rungs[Math.min(rungs.length - 1, Math.max(0, i))];
}

export type SkillLabel = { lowTier: string; highTier: string; label: string; system: string };

/** "≈ 3.5–4.0 NTRP" / "≈ Rec League – High School" for an estimate's interval. */
export function describeSkill(sport: string, est: Pick<SkillEstimate, "low" | "high">): SkillLabel {
  const scale = scaleFor(sport);
  const lowTier = scoreToTier(sport, est.low);
  const highTier = scoreToTier(sport, est.high);
  const numeric = /^[0-9]+(\.[0-9]+)?$/.test(lowTier);
  const range = lowTier === highTier ? lowTier : `${lowTier}${numeric ? "–" : " – "}${highTier}`;
  const label = numeric ? `${range} ${scale.system}` : range;
  return { lowTier, highTier, label: `≈ ${label}`, system: scale.system };
}

/** Peer-vote reference: the average self-rated level of everyone in a game. */
export function gameReferenceLevel(selfScores: Array<number | null | undefined>): number {
  const xs = selfScores.filter((v): v is number => typeof v === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : SKILL.priorMean;
}

/** Voters whose own rating is settled count for more (0.5–1.2); unknown voters 0.8. */
export function voterWeight(voterSigma: number | null | undefined): number {
  if (voterSigma == null) return 0.8;
  return clamp(1.2 - (voterSigma - SKILL.establishedSigma) / 40, 0.5, 1.2);
}

export type LevelFit = "open" | "fit" | "stretch" | "easy";

/**
 * How a game's advertised level compares with a player's rating range.
 *  - open:    the game is "All Levels" (or has no readable tier)
 *  - fit:     the ranges overlap
 *  - stretch: the game is above the player's range
 *  - easy:    the game is below the player's range
 * Each tier gets half a rung of tolerance either side, since tiers are coarse.
 */
export function levelFit(
  sport: string,
  gameSkill: string | null | undefined,
  player: Pick<SkillEstimate, "low" | "high">,
): LevelFit {
  const scores = parseSkillTiers(sport, gameSkill)
    .map((t) => tierToScore(sport, t))
    .filter((v): v is number => v != null);
  if (scores.length === 0) return "open";
  const rungs = ladder(scaleFor(sport)).length;
  const half = rungs > 1 ? 40 / (rungs - 1) : 40;
  const gLow = Math.min(...scores) - half;
  const gHigh = Math.max(...scores) + half;
  if (player.high < gLow) return "stretch";
  if (player.low > gHigh) return "easy";
  return "fit";
}
