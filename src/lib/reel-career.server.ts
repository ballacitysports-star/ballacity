/**
 * Career Film Room (server-only).
 *
 * Every other AI feature looks at one reel. This one reads across the reels an
 * athlete has already had analysed and answers the question a single clip
 * cannot: what keeps showing up? Recurring strengths, the fix that has been
 * outstanding for weeks, whether the footage is trending better or worse, and
 * what to actually do at the next session.
 *
 * It is strictly derivative — it reads the `ai_*` columns the pipeline already
 * wrote and never re-reads the video, so it costs one text call regardless of
 * how many reels are in the window. The report is private to the athlete and is
 * not persisted.
 */

import { runAiCall, type AiSession } from "@/lib/ai/gate.server";

/** Reels are summaries-only here: no media paths are needed or read. */
export const CAREER_COLUMNS =
  "id,title,ai_title,ai_sport,ai_analysis,ai_coaching,ai_moments,ai_timeline,ai_edit_plan,created_at,game_title,status";

/** Upper bound on reels fed to one report, newest first. */
export const CAREER_MAX_REELS = 25;
/** Below this there is no "pattern" to find, only a single clip's opinion. */
export const CAREER_MIN_REELS = 2;

export type CareerStrength = { skill: string; evidence: string };
export type CareerFix = { issue: string; why: string; drill: string };
export type TrendDirection = "improving" | "steady" | "mixed" | "unclear";

export type CareerReport = {
  /** The sport the window is mostly about, when one dominates. */
  sport: string | null;
  reelsAnalyzed: number;
  /** ISO dates of the oldest and newest reel in the window. */
  window: { from: string | null; to: string | null };
  headline: string;
  strengths: CareerStrength[];
  fixes: CareerFix[];
  trend: { direction: TrendDirection; note: string };
  nextSession: string[];
  filmingTips: string[];
};

const TREND_DIRECTIONS: TrendDirection[] = ["improving", "steady", "mixed", "unclear"];

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

function strList(v: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => str(item, itemMax))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * One compact line per reel. Deliberately lossy: the model needs the shape of
 * the pattern across reels, not every timeline beat from each one.
 */
function reelLine(r: Record<string, any>, index: number): string {
  const date = r.created_at ? String(r.created_at).slice(0, 10) : "unknown date";
  const coaching = r.ai_coaching ?? {};
  const parts = [
    `${index}. [${date}] "${r.ai_title || r.title}"`,
    r.ai_sport ? `sport: ${r.ai_sport}` : "",
    r.game_title ? `game: ${r.game_title}` : "",
    r.ai_analysis?.summary ? `shows: ${String(r.ai_analysis.summary).slice(0, 300)}` : "",
    r.ai_analysis?.quality_note
      ? `footage: ${String(r.ai_analysis.quality_note).slice(0, 160)}`
      : "",
    (coaching.strengths ?? []).length
      ? `strengths: ${strList(coaching.strengths, 4, 120).join("; ")}`
      : "",
    (coaching.notes ?? []).length ? `fix: ${strList(coaching.notes, 4, 120).join("; ")}` : "",
    (coaching.drills ?? []).length ? `drills: ${strList(coaching.drills, 3, 120).join("; ")}` : "",
    (r.ai_moments ?? []).length
      ? `moments: ${(r.ai_moments ?? [])
          .slice(0, 5)
          .map((m: any) => str(m?.label, 60))
          .filter(Boolean)
          .join(", ")}`
      : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

/** Oldest-first grounding so any trend the model reports reads in time order. */
export function buildCareerGrounding(reels: Record<string, any>[]): string {
  return [...reels]
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map((r, i) => reelLine(r, i + 1))
    .join("\n");
}

/** The sport appearing most often in the window, or null when there is no clear one. */
function dominantSport(reels: Record<string, any>[]): string | null {
  const counts = new Map<string, number>();
  for (const r of reels) {
    const sport = str(r.ai_sport, 40).toLowerCase();
    if (sport) counts.set(sport, (counts.get(sport) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [sport, count] of counts) {
    if (count > bestCount) {
      best = sport;
      bestCount = count;
    }
  }
  return best;
}

const SYSTEM = [
  "You are a strength-and-skills coach reviewing an athlete's own highlight archive in a pickup-sports app.",
  "You are given one line per reel, oldest first, summarising what each clip showed and what a per-clip coach already said.",
  "Return ONLY JSON of this shape:",
  '{"sport":"basketball|null","headline":"one sentence","strengths":[{"skill":"...","evidence":"..."}],',
  '"fixes":[{"issue":"...","why":"...","drill":"..."}],"trend":{"direction":"improving|steady|mixed|unclear","note":"..."},',
  '"next_session":["..."],"filming_tips":["..."]}',
  "Rules:",
  "- Report only patterns that appear in MORE THAN ONE reel. A one-off is not a pattern; if nothing recurs, say so in the headline and keep the lists short.",
  "- strengths: 2-4 items. `evidence` must cite which reels/dates it came from.",
  "- fixes: 2-4 items, most valuable first. `drill` is one concrete thing to do at practice.",
  "- trend: judge only from how the reels change over time. Use 'unclear' when the window is too short or too mixed to tell — do not guess a direction to sound encouraging.",
  "- next_session: 3-5 short imperatives for their next run.",
  "- filming_tips: 0-3 items, only if the footage notes show a recurring camera problem.",
  "- Never invent scores, stats, opponents, teams or player names. Never estimate height, speed or physical measurements.",
  "- Be specific and plain. No hype, no praise padding.",
].join("\n");

/**
 * Builds one cross-reel report. `reels` must already be scoped to the caller —
 * this function never filters by owner itself.
 */
export async function generateCareerReport(
  reels: Record<string, any>[],
  opts: { session: AiSession; focus?: string },
): Promise<CareerReport> {
  const window = [...reels]
    .map((r) => (r.created_at ? String(r.created_at).slice(0, 10) : null))
    .filter((d): d is string => Boolean(d))
    .sort();

  const grounding = buildCareerGrounding(reels);
  if (!grounding.trim()) {
    throw new Error("These reels have no AI analysis yet — process them first");
  }

  const out = await runAiCall(opts.session, (provider) =>
    provider.generateStructured<Record<string, any>>({
      system: SYSTEM,
      prompt: [
        `The athlete has ${reels.length} analysed reels in this window.`,
        opts.focus ? `They specifically want feedback on: ${opts.focus}` : "",
        "",
        grounding,
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  );

  const raw = out.data ?? {};
  const trendDirection = TREND_DIRECTIONS.includes(raw.trend?.direction)
    ? (raw.trend.direction as TrendDirection)
    : "unclear";

  const strengths: CareerStrength[] = Array.isArray(raw.strengths)
    ? raw.strengths
        .map((s: any) => ({ skill: str(s?.skill, 80), evidence: str(s?.evidence, 240) }))
        .filter((s: CareerStrength) => s.skill.length > 0)
        .slice(0, 4)
    : [];

  const fixes: CareerFix[] = Array.isArray(raw.fixes)
    ? raw.fixes
        .map((f: any) => ({
          issue: str(f?.issue, 100),
          why: str(f?.why, 240),
          drill: str(f?.drill, 240),
        }))
        .filter((f: CareerFix) => f.issue.length > 0)
        .slice(0, 4)
    : [];

  const headline = str(raw.headline, 240);

  if (!headline && strengths.length === 0 && fixes.length === 0) {
    throw new Error("The film room came back empty — try again");
  }

  return {
    sport: str(raw.sport, 40) || dominantSport(reels),
    reelsAnalyzed: reels.length,
    window: { from: window[0] ?? null, to: window[window.length - 1] ?? null },
    headline,
    strengths,
    fixes,
    trend: { direction: trendDirection, note: str(raw.trend?.note, 300) },
    nextSession: strList(raw.next_session, 5, 160),
    filmingTips: strList(raw.filming_tips, 3, 160),
  };
}
