/**
 * Skill rating computation (server only). Gathers the signals, runs the pure
 * engine in `skill-rating.ts`, stores the result, and — on request — asks the
 * AI to explain it. Adults only; nothing here ever reads review text.
 */

import { runAiCall } from "@/lib/ai/gate.server";
import { moderateAiFields } from "@/lib/ai/moderation.server";
import { withAiSession } from "@/lib/ai/session.server";
import {
  describeSkill,
  estimateSkill,
  gameReferenceLevel,
  tierToScore,
  voterWeight,
  type SkillEstimate,
  type SkillSignal,
} from "@/lib/skill-rating";
import { parseSportLevels } from "@/lib/sport-levels";

const YEAR = 365 * 86_400_000;

type Gathered = { signals: SkillSignal[]; selfTier: string | null; selfScore: number | null };

const sportsOf = (raw: unknown) => Object.keys(parseSportLevels(raw));

export async function sportsWithSignals(admin: any, userId: string): Promise<string[]> {
  const { data: prof } = await admin
    .from("profiles")
    .select("sport_levels")
    .eq("id", userId)
    .maybeSingle();
  const { data: votes } = await admin.from("skill_votes").select("sport").eq("subject_id", userId);
  return Array.from(
    new Set([
      ...sportsOf(prof?.sport_levels),
      ...((votes ?? []) as { sport: string }[]).map((v) => v.sport),
    ]),
  );
}

export async function gatherSignals(admin: any, userId: string, sport: string): Promise<Gathered> {
  const signals: SkillSignal[] = [];

  // 1. Self-chosen level
  const { data: prof } = await admin
    .from("profiles")
    .select("sport_levels")
    .eq("id", userId)
    .maybeSingle();
  const level = parseSportLevels(prof?.sport_levels)[sport];
  const selfScore = level?.tier ? tierToScore(sport, level.tier) : null;
  if (selfScore != null) signals.push({ kind: "self", value: selfScore });

  // 2. Peer votes, each anchored to the typical level of the game it came from
  const since = new Date(Date.now() - YEAR).toISOString();
  const { data: votes } = await admin
    .from("skill_votes")
    .select("game_id, voter_id, vote, created_at")
    .eq("subject_id", userId)
    .eq("sport", sport)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows: { game_id: string; voter_id: string; vote: -1 | 0 | 1; created_at: string }[] =
    votes ?? [];
  if (rows.length) {
    const gameIds = Array.from(new Set(rows.map((r) => r.game_id)));
    const { data: parts } = await admin
      .from("game_participants")
      .select("game_id, user_id")
      .in("game_id", gameIds);
    const people = Array.from(new Set((parts ?? []).map((p: any) => p.user_id as string)));
    const { data: profs } = people.length
      ? await admin.from("profiles").select("id, sport_levels").in("id", people)
      : { data: [] };
    const selfBy = new Map<string, number | null>(
      (profs ?? []).map((p: any) => {
        const l = parseSportLevels(p.sport_levels)[sport];
        return [p.id as string, l?.tier ? tierToScore(sport, l.tier) : null];
      }),
    );
    const byGame = new Map<string, number>();
    for (const g of gameIds) {
      const others = (parts ?? [])
        .filter((p: any) => p.game_id === g && p.user_id !== userId)
        .map((p: any) => selfBy.get(p.user_id));
      byGame.set(g, gameReferenceLevel(others));
    }
    const { data: voterRatings } = await admin
      .from("skill_ratings")
      .select("user_id, sigma")
      .eq("sport", sport)
      .in("user_id", Array.from(new Set(rows.map((r) => r.voter_id))));
    const sigmaBy = new Map<string, number>(
      (voterRatings ?? []).map((r: any) => [r.user_id, Number(r.sigma)]),
    );
    for (const r of rows) {
      signals.push({
        kind: "peer",
        vote: r.vote,
        gameLevel: byGame.get(r.game_id) ?? 50,
        weight: voterWeight(sigmaBy.get(r.voter_id)),
        date: r.created_at,
      });
    }
  }

  // 3. Video analysis (only if the member allows AI analysis of their media)
  const { data: allowed } = await admin.rpc("ai_analysis_allowed", { _user: userId });
  if (allowed === true) {
    const { data: reels } = await admin
      .from("highlight_reels")
      .select("ai_sport, ai_advanced_analytics, completed_at, created_at")
      .eq("user_id", userId)
      .not("ai_advanced_analytics", "is", null)
      .order("created_at", { ascending: false })
      .limit(8);
    for (const r of reels ?? []) {
      const a = r.ai_advanced_analytics as {
        sport?: string | null;
        ratings?: { overall?: number };
      } | null;
      const s = (a?.sport ?? r.ai_sport ?? "").toLowerCase();
      const overall = Number(a?.ratings?.overall);
      if (s === sport.toLowerCase() && Number.isFinite(overall)) {
        signals.push({ kind: "video", value: overall, date: r.completed_at ?? r.created_at });
      }
    }
  }

  return { signals, selfTier: level?.tier ?? null, selfScore };
}

/** Recomputes and stores one sport's rating. Returns null when there is nothing to rate or the player is a minor. */
export async function recomputeSkill(
  admin: any,
  userId: string,
  sport: string,
): Promise<SkillEstimate | null> {
  const { data: cohort } = await admin.rpc("age_cohort_of", { _user: userId });
  if (cohort !== "adult") {
    await admin.from("skill_ratings").delete().eq("user_id", userId);
    return null;
  }
  const { signals, selfTier } = await gatherSignals(admin, userId, sport);
  if (signals.length === 0) return null;

  const est = estimateSkill(signals);
  await admin.from("skill_ratings").upsert(
    {
      user_id: userId,
      sport,
      mu: est.mu,
      sigma: est.sigma,
      low: est.low,
      high: est.high,
      status: est.status,
      label: describeSkill(sport, est).label,
      self_tier: selfTier,
      signals: { contributions: est.contributions, counts: est.counts },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,sport" },
  );
  return est;
}

// ---------------------------------------------------------------------------
// AI scouting report
// ---------------------------------------------------------------------------

export type SkillReport = {
  headline: string;
  whyItMoved: string[];
  strengths: string[];
  workOn: string[];
  positions: string[];
  levelNote: string;
};

const cap = (v: unknown, n: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const list = (v: unknown, n: number, len: number) =>
  Array.isArray(v)
    ? v
        .map((x) => cap(x, len))
        .filter(Boolean)
        .slice(0, n)
    : [];

export function normalizeSkillReport(raw: unknown): SkillReport | null {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const headline = cap(s["headline"], 140);
  if (!headline) return null;
  return {
    headline,
    whyItMoved: list(s["whyItMoved"], 3, 160),
    strengths: list(s["strengths"], 3, 80),
    workOn: list(s["workOn"], 3, 80),
    positions: list(s["positions"], 3, 40),
    levelNote: cap(s["levelNote"], 200),
  };
}

export async function generateSkillReport(
  admin: any,
  userId: string,
  sport: string,
): Promise<SkillReport> {
  const { signals, selfTier, selfScore } = await gatherSignals(admin, userId, sport);
  if (signals.length === 0) throw new Error("Not enough information to rate you yet.");
  const now = estimateSkill(signals);

  // What the last 30 days changed: same engine, only evidence older than that.
  const cutoff = Date.now() - 30 * 86_400_000;
  const older = signals.filter((s) => s.kind === "self" || Date.parse(s.date) <= cutoff);
  const before = estimateSkill(older);
  const delta = Math.round((now.mu - before.mu) * 10) / 10;

  // Strengths from the latest clip's sub-ratings, if any.
  const { data: reels } = await admin
    .from("highlight_reels")
    .select("ai_advanced_analytics")
    .eq("user_id", userId)
    .not("ai_advanced_analytics", "is", null)
    .order("created_at", { ascending: false })
    .limit(3);
  const subs = new Map<string, number[]>();
  for (const r of reels ?? []) {
    const rt =
      (r.ai_advanced_analytics as { ratings?: Record<string, number> } | null)?.ratings ?? {};
    for (const k of ["mechanics", "explosiveness", "iq", "execution"]) {
      if (Number.isFinite(Number(rt[k]))) subs.set(k, [...(subs.get(k) ?? []), Number(rt[k])]);
    }
  }
  const sub = Object.fromEntries(
    [...subs].map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]),
  );

  const facts = {
    sport,
    selfChosenLevel: selfTier,
    selfVsMeasuredGap: selfScore == null ? null : Math.round(selfScore - now.mu),
    rating: { mid: now.mu, low: now.low, high: now.high, status: now.status },
    changeLast30Days: delta,
    evidenceShare: {
      self: Math.round(now.contributions.self * 100),
      peerVotes: Math.round(now.contributions.peer * 100),
      video: Math.round(now.contributions.video * 100),
    },
    counts: now.counts,
    videoSubRatings: sub,
    scale: describeSkill(sport, now).label,
  };

  return withAiSession({ admin, userId, feature: "skill_assessment" }, async (session) => {
    const out = await runAiCall(session, (p) =>
      p.generateStructured<Record<string, unknown>>({
        system:
          "You are a fair, encouraging sports scout writing a short rating explanation for an adult recreational athlete. " +
          "Use ONLY the numbers in the FACTS JSON; never invent games, opponents, scores or injuries. " +
          "Be honest about uncertainty (status provisional = limited evidence). Explain why the rating moved using changeLast30Days and evidenceShare. " +
          "If selfVsMeasuredGap is at least 12 say the self-chosen level looks high; at most -12 say it looks low; otherwise say it matches. " +
          "Suggest up to 3 common positions for the sport that fit the sub-ratings (empty if no sub-ratings). " +
          'Reply with JSON only: {"headline": string, "whyItMoved": string[], "strengths": string[], "workOn": string[], "positions": string[], "levelNote": string}.',
        prompt: `FACTS:\n${JSON.stringify(facts)}`,
      }),
    );
    const report = normalizeSkillReport(out.data);
    if (!report) throw new Error("Couldn't write the report right now. Try again in a bit.");

    const safe = await moderateAiFields(admin, {
      userId,
      table: "skill_ratings",
      id: `${userId}:${sport}`,
      fields: {
        text: [
          report.headline,
          ...report.whyItMoved,
          ...report.strengths,
          ...report.workOn,
          report.levelNote,
        ].join(" | "),
      },
    });
    if (safe.blocked.length || safe.review.length || safe.unavailable) {
      throw new Error("Couldn't write the report right now. Try again in a bit.");
    }
    await admin
      .from("skill_ratings")
      .update({ report, report_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("sport", sport);
    return report;
  });
}
