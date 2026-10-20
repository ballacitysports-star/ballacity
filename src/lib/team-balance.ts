/**
 * Balanced team picking for hosts. Pure and deterministic for a given seed.
 *
 * Each player brings a skill estimate (0–100, from `skill-rating.ts`). Teams are
 * dealt from strongest to weakest onto whichever team is smallest and then
 * weakest, then improved by pairwise swaps; a few dozen seeded random restarts
 * get past splits that no single swap can improve, and the split with the
 * smallest gap between team averages wins. Team sizes never differ by more
 * than one. The seed drives the restarts and tie-breaks, so "shuffle" gives a
 * different but equally fair split.
 */

import { SKILL, estimateSkill } from "@/lib/skill-rating";

export type BalancePlayer = { id: string; mu: number };

export type BalancedTeam = { players: BalancePlayer[]; average: number };

export type BalanceQuality = "even" | "close" | "uneven";

export type BalanceResult = {
  teams: BalancedTeam[];
  /** Difference between the strongest and weakest team averages, in rating points. */
  gap: number;
  quality: BalanceQuality;
};

/** Average gaps (rating points) at or under which a split counts as even / close. */
export const BALANCE_THRESHOLDS = { even: 3, close: 7 } as const;

/** Small seeded PRNG (mulberry32) so the same seed always gives the same split. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const avg = (ps: BalancePlayer[]) => (ps.length ? ps.reduce((s, p) => s + p.mu, 0) / ps.length : 0);

function spread(teams: BalancePlayer[][]): number {
  const avgs = teams.filter((t) => t.length > 0).map(avg);
  return avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0;
}

/** Size-weighted squared distance of each team's average from the overall average. */
function imbalance(teams: BalancePlayer[][], mean: number): number {
  return teams.reduce((s, t) => s + t.length * (avg(t) - mean) ** 2, 0);
}

/** Deal strongest-first onto the smallest, then weakest, team. */
function greedyDeal(sorted: BalancePlayer[], n: number): BalancePlayer[][] {
  const teams: BalancePlayer[][] = Array.from({ length: n }, () => []);
  const totals = new Array<number>(n).fill(0);
  for (const p of sorted) {
    let best = 0;
    for (let i = 1; i < n; i++) {
      const fewer = teams[i].length < teams[best].length;
      const same = teams[i].length === teams[best].length;
      if (fewer || (same && totals[i] < totals[best])) best = i;
    }
    teams[best].push(p);
    totals[best] += p.mu;
  }
  return teams;
}

/** Round-robin deal of a shuffled list: sizes stay within one. */
function randomDeal(players: BalancePlayer[], n: number, rand: () => number): BalancePlayer[][] {
  const shuffled = players
    .map((p) => ({ p, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
  const teams: BalancePlayer[][] = Array.from({ length: n }, () => []);
  shuffled.forEach((p, i) => teams[i % n].push(p));
  return teams;
}

/** Pairwise swaps (sizes fixed) while any swap strictly reduces the imbalance. */
function descend(teams: BalancePlayer[][], mean: number): void {
  let current = imbalance(teams, mean);
  for (let improved = true, guard = 0; improved && guard < 1000; guard++) {
    improved = false;
    for (let a = 0; a < teams.length && !improved; a++) {
      for (let b = a + 1; b < teams.length && !improved; b++) {
        for (let i = 0; i < teams[a].length && !improved; i++) {
          for (let j = 0; j < teams[b].length && !improved; j++) {
            const pa = teams[a][i];
            const pb = teams[b][j];
            if (pa.mu === pb.mu) continue;
            teams[a][i] = pb;
            teams[b][j] = pa;
            const next = imbalance(teams, mean);
            if (next < current - 1e-9) {
              current = next;
              improved = true;
            } else {
              teams[a][i] = pa;
              teams[b][j] = pb;
            }
          }
        }
      }
    }
  }
}

/** Random restarts on top of the greedy deal; pickup rosters are small. */
const RESTARTS = 40;

export function balanceTeams(players: BalancePlayer[], teamCount = 2, seed = 1): BalanceResult {
  const n = Math.max(1, Math.min(Math.floor(teamCount), players.length || 1));
  const rand = rng(seed);
  const mean = avg(players);

  // Seeded shuffle, then a stable sort: ties keep their shuffled order.
  const sorted = players
    .map((p) => ({ p, r: rand() }))
    .sort((a, b) => b.p.mu - a.p.mu || a.r - b.r)
    .map((x) => x.p);

  let best: BalancePlayer[][] | null = null;
  let bestSpread = Infinity;
  let bestImbalance = Infinity;
  for (let k = 0; k <= RESTARTS; k++) {
    const teams = k === 0 ? greedyDeal(sorted, n) : randomDeal(players, n, rand);
    descend(teams, mean);
    const sp = spread(teams);
    const im = imbalance(teams, mean);
    if (sp < bestSpread - 1e-9 || (Math.abs(sp - bestSpread) <= 1e-9 && im < bestImbalance)) {
      best = teams;
      bestSpread = sp;
      bestImbalance = im;
    }
    if (bestSpread <= 1e-9) break;
  }

  const teams = best ?? [[]];
  const gap = Math.round(bestSpread === Infinity ? 0 : bestSpread * 10) / 10;
  return {
    teams: teams.map((ps) => ({
      players: [...ps].sort((x, y) => y.mu - x.mu),
      average: Math.round(avg(ps) * 10) / 10,
    })),
    gap,
    quality:
      gap <= BALANCE_THRESHOLDS.even
        ? "even"
        : gap <= BALANCE_THRESHOLDS.close
          ? "close"
          : "uneven",
  };
}

/**
 * The skill value used for one player: their stored rating if they have one,
 * else what their self-chosen level alone implies, else the platform prior.
 */
export function playerStrength(input: { ratingMu?: number | null; selfScore?: number | null }): {
  mu: number;
  source: "rating" | "self" | "none";
} {
  if (typeof input.ratingMu === "number" && Number.isFinite(input.ratingMu)) {
    return { mu: input.ratingMu, source: "rating" };
  }
  if (typeof input.selfScore === "number" && Number.isFinite(input.selfScore)) {
    return { mu: estimateSkill([{ kind: "self", value: input.selfScore }]).mu, source: "self" };
  }
  return { mu: SKILL.priorMean, source: "none" };
}
