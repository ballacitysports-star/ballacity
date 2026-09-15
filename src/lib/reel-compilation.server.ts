/**
 * Auto-generated highlight compilations (server-only).
 *
 * Picks the strongest moments across several of the athlete's reels and orders
 * them into one cut — the "best of" edit that otherwise means scrubbing every
 * clip by hand. The output is the same shape of cut list the existing player
 * already renders, extended with the reel each segment comes from.
 *
 * Nothing here trusts the model with timing. Every returned clip must name a
 * reel the caller actually owns, and its in/out points are clamped to that
 * reel's known duration before it reaches a client, so a hallucinated reel id
 * or a 90-second clip out of a 12-second video cannot survive.
 */

import { runAiCall, type AiSession } from "@/lib/ai/gate.server";
import { reelStyleDirectives } from "@/lib/reel-style";

export const COMPILATION_COLUMNS =
  "id,title,ai_title,ai_sport,ai_analysis,ai_moments,ai_timeline,ai_edit_plan,suggested_clip,media_meta,frame_times,created_at,game_title,style_prefs,status";

export const COMPILATION_MAX_REELS = 12;
export const COMPILATION_MIN_REELS = 2;
/** Clips shorter than this read as a glitch rather than a moment. */
const MIN_CLIP_SECONDS = 0.8;
const MAX_CLIP_SECONDS = 12;
const MAX_CLIPS = 12;

const PACES = ["normal", "slowmo", "hold", "quick"] as const;
export type ClipPace = (typeof PACES)[number];

export type CompilationClip = {
  reelId: string;
  reelTitle: string;
  start: number;
  end: number;
  pace: ClipPace;
  label: string;
  why: string;
};

export type ReelCompilation = {
  title: string;
  why: string;
  /** Sum of the kept clips, in seconds. */
  totalSeconds: number;
  clips: CompilationClip[];
  /** Reels that contributed at least one clip. */
  reelIds: string[];
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Best available duration for a reel: the probe value when the browser recorded
 * one, else the last sampled frame time. Null when neither is known, which
 * makes the reel unusable for a compilation.
 */
export function reelDuration(r: Record<string, any>): number | null {
  const probed = Number(r?.media_meta?.durationSeconds);
  if (Number.isFinite(probed) && probed > 0) return probed;
  const times = Array.isArray(r?.frame_times) ? r.frame_times.map(Number) : [];
  const last = times
    .filter((t: number) => Number.isFinite(t))
    .sort((a, b) => a - b)
    .pop();
  return typeof last === "number" && last > 0 ? last : null;
}

/** One block per reel: its id, length, and the beats already detected in it. */
function reelBlock(r: Record<string, any>, duration: number): string {
  const moments = (r.ai_moments ?? [])
    .slice(0, 8)
    .map((m: any) => {
      const t = Number(m?.t ?? m?.timestamp);
      const label = str(m?.label, 60);
      if (!label) return "";
      return Number.isFinite(t) ? `${round(t)}s ${label}` : label;
    })
    .filter(Boolean)
    .join("; ");

  const timeline = (r.ai_timeline ?? [])
    .slice(0, 8)
    .map((e: any) => {
      const t = Number(e?.t);
      const label = str(e?.label, 60);
      if (!label) return "";
      return Number.isFinite(t) ? `${round(t)}s ${label}` : label;
    })
    .filter(Boolean)
    .join("; ");

  const suggested =
    r.suggested_clip?.start != null
      ? `best window ${round(Number(r.suggested_clip.start))}-${round(Number(r.suggested_clip.end))}s`
      : "";

  return [
    `REEL ${r.id}`,
    `  title: ${r.ai_title || r.title}`,
    `  length: ${round(duration)}s`,
    r.ai_sport ? `  sport: ${r.ai_sport}` : "",
    r.game_title ? `  game: ${r.game_title}` : "",
    r.ai_analysis?.summary ? `  shows: ${str(r.ai_analysis.summary, 240)}` : "",
    moments ? `  moments: ${moments}` : "",
    timeline ? `  play-by-play: ${timeline}` : "",
    suggested ? `  ${suggested}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const SYSTEM = [
  "You are a highlight editor building ONE compilation reel from an athlete's separate clips.",
  "Return ONLY JSON of this shape:",
  '{"title":"...","why":"one sentence","clips":[{"reel_id":"<exact id>","start":2.5,"end":6,"pace":"normal|slowmo|hold|quick","label":"short","why":"one line"}]}',
  "Rules:",
  "- reel_id MUST be copied exactly from a REEL block. Never invent one.",
  "- start/end are seconds inside THAT reel and must fall within its stated length.",
  "- Pick the single best moment from a reel; only use a reel twice if it clearly has two separate highlights.",
  "- Order the clips for watchability: open on the strongest moment, keep the energy, end on a clean finish.",
  "- 3 to 8 clips total, each 1-8 seconds. Prefer a tight cut over a long one.",
  "- Use 'slowmo' only for a genuine peak moment, 'hold' only for a reaction or a still finish.",
  "- title: under 60 characters, no hashtags.",
  "- Never invent scores, stats, opponents or player names.",
].join("\n");

/**
 * Builds one compilation across `reels`, which must already be scoped to the
 * caller. Reels with no known duration are dropped before the model sees them.
 */
export async function generateCompilation(
  reels: Record<string, any>[],
  opts: { session: AiSession; theme?: string },
): Promise<ReelCompilation> {
  // Only reels we can bound in time are eligible — everything else cannot be
  // clipped safely on the way back out.
  const usable = reels
    .map((r) => ({ reel: r, duration: reelDuration(r) }))
    .filter((x): x is { reel: Record<string, any>; duration: number } => x.duration !== null);

  if (usable.length < COMPILATION_MIN_REELS) {
    throw new Error(
      `A compilation needs at least ${COMPILATION_MIN_REELS} processed reels with known length`,
    );
  }

  const byId = new Map(usable.map((x) => [String(x.reel.id), x]));
  const style = reelStyleDirectives(usable[0].reel.style_prefs);

  const out = await runAiCall(opts.session, (provider) =>
    provider.generateStructured<Record<string, any>>({
      system: SYSTEM,
      prompt: [
        `Build a compilation from these ${usable.length} reels.`,
        opts.theme ? `Theme requested by the athlete: ${opts.theme}` : "",
        style.edit ? `Editing style: ${style.edit}` : "",
        "",
        usable.map((x) => reelBlock(x.reel, x.duration)).join("\n\n"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  );

  const raw = out.data ?? {};
  const clips: CompilationClip[] = [];

  for (const c of Array.isArray(raw.clips) ? raw.clips : []) {
    const entry = byId.get(str(c?.reel_id, 64));
    // A clip naming a reel the caller does not own is dropped outright.
    if (!entry) continue;

    const duration = entry.duration;
    let start = Number(c?.start);
    let end = Number(c?.end);
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end <= start) end = start + 2;

    // Clamp into the reel, then enforce a sane clip length.
    start = Math.min(Math.max(0, start), Math.max(0, duration - MIN_CLIP_SECONDS));
    end = Math.min(end, duration);
    if (end - start < MIN_CLIP_SECONDS) end = Math.min(start + MIN_CLIP_SECONDS, duration);
    if (end - start > MAX_CLIP_SECONDS) end = start + MAX_CLIP_SECONDS;
    if (end - start < MIN_CLIP_SECONDS) continue;

    clips.push({
      reelId: String(entry.reel.id),
      reelTitle: str(entry.reel.ai_title || entry.reel.title, 120),
      start: round(start),
      end: round(end),
      pace: PACES.includes(c?.pace) ? (c.pace as ClipPace) : "normal",
      label: str(c?.label, 60),
      why: str(c?.why, 200),
    });
    if (clips.length >= MAX_CLIPS) break;
  }

  if (clips.length === 0) {
    throw new Error("The compilation came back with no usable clips — try again");
  }

  return {
    title: str(raw.title, 120) || "Highlight compilation",
    why: str(raw.why, 300),
    totalSeconds: round(clips.reduce((n, c) => n + (c.end - c.start), 0)),
    clips,
    reelIds: [...new Set(clips.map((c) => c.reelId))],
  };
}
