/**
 * Server-only helpers for the Reel Coach sports agent.
 *
 * Keeps the grounding text and the "reel package" generation (caption +
 * on-screen text moments + hashtags) out of the server-function module, which
 * must stay a thin wrapper.
 */

import { DEFAULT_AI_PROVIDER } from "@/lib/ai/config";
import { runAiCall, type AiSession } from "@/lib/ai/gate.server";
import { createLovableGatewayProvider } from "@/lib/ai/gateway.server";
import { reelStyleDirectives } from "@/lib/reel-style";

export const REEL_COACH_COLUMNS =
  "id,title,ai_title,ai_caption,ai_hashtags,ai_sport,ai_analysis,ai_moments,ai_overlays,ai_timeline,ai_edit_plan,ai_coaching,ai_transcript,suggested_clip,game_title,status,style_prefs";

export type ReelOverlay = {
  /** Where the text should appear, e.g. "0:03" or "the dunk". */
  at: string;
  /** Short on-screen text (kept punchy so it reads on a phone). */
  text: string;
};

export type ReelPackage = {
  sport: string | null;
  /** The first caption variant, kept for back-compat. */
  caption: string;
  /** Three distinct caption variants the athlete can pick from. */
  captions: string[];
  overlays: ReelOverlay[];
  hashtags: string[];
};

/** Everything the AI knows about one reel, as plain prompt text. */
export function buildReelGrounding(r: Record<string, any>): string {
  return [
    `Reel title: ${r.ai_title || r.title}`,
    r.game_title ? `Game: ${r.game_title}` : "",
    r.ai_sport ? `Sport: ${r.ai_sport}` : "",
    r.ai_caption ? `Current caption: ${r.ai_caption}` : "",
    (r.ai_hashtags ?? []).length ? `Hashtags: ${(r.ai_hashtags ?? []).join(", ")}` : "",
    r.ai_analysis?.summary ? `What the footage shows: ${r.ai_analysis.summary}` : "",
    r.ai_analysis?.quality_note ? `Footage quality: ${r.ai_analysis.quality_note}` : "",
    (r.ai_moments ?? []).length
      ? `Key moments: ${(r.ai_moments ?? [])
          .map((m: any) => [m.timestamp ?? m.t, m.label].filter(Boolean).join(" — "))
          .join("; ")}`
      : "",
    (r.ai_timeline ?? []).length
      ? `Play-by-play: ${(r.ai_timeline ?? [])
          .map((e: any) => `${e.t}s ${e.label}${e.note ? ` (${e.note})` : ""}`)
          .join("; ")}`
      : "",
    r.ai_edit_plan?.segments?.length
      ? `Planned cut: ${r.ai_edit_plan.segments
          .map((s: any) => `${s.start}-${s.end}s ${s.pace}`)
          .join("; ")}${r.ai_edit_plan.why ? ` — ${r.ai_edit_plan.why}` : ""}`
      : "",
    r.ai_coaching
      ? `Coaching — strengths: ${(r.ai_coaching.strengths ?? []).join("; ")} | fix: ${(
          r.ai_coaching.notes ?? []
        ).join("; ")} | drills: ${(r.ai_coaching.drills ?? []).join("; ")}`
      : "",
    r.ai_transcript?.text ? `Spoken audio: ${String(r.ai_transcript.text).slice(0, 600)}` : "",
    r.suggested_clip?.start != null
      ? `Suggested clip window: ${r.suggested_clip.start}s to ${r.suggested_clip.end}s`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * JSON call routed through the shared AI service layer (same model, prompts and
 * output as before): retries, usage accounting and typed errors come from there.
 * `session` is present whenever the caller passed through the AI gate.
 */
export async function callReelJson(
  apiKey: string,
  system: string,
  user: string,
  session?: AiSession | null,
): Promise<Record<string, any>> {
  const request = { system, prompt: user };
  if (session) {
    const out = await runAiCall(session, (provider) =>
      provider.generateStructured<Record<string, any>>(request),
    );
    return out.data;
  }
  const provider = createLovableGatewayProvider(DEFAULT_AI_PROVIDER);
  return (await provider.generateStructured<Record<string, any>>(request)).data;
}

const SPORT_HINTS: Record<string, string> = {
  basketball:
    "Use hoops language (bucket, handles, and-1, dime, poster) and reference court actions only if the footage shows them.",
  football: "Use football language (route, pocket, snag, six) and stay accurate about pass vs run.",
  soccer: "Use football/soccer language (finish, first touch, curler, keeper) with global appeal.",
  baseball: "Use baseball language (barrel, gap, frozen rope, dish) without inventing counts.",
  softball: "Use softball language (barrel, gap, dish) without inventing counts.",
  volleyball: "Use volleyball language (kill, dig, set, roof).",
  tennis: "Use tennis language (winner, rally, passing shot).",
  pickleball: "Use pickleball language (dink, kitchen, put-away).",
  running: "Use running language (splits, kick, negative split) without inventing times.",
};

/**
 * Generates a publish-ready package for one reel: an optimized caption, a list
 * of on-screen text moments timed to the footage, and sport-tailored hashtags.
 */
export async function generateReelPackage(
  apiKey: string,
  reel: Record<string, any>,
  opts: { tone?: string; session?: AiSession | null } = {},
): Promise<ReelPackage> {
  const sport = reel.ai_sport ? String(reel.ai_sport) : null;
  const sportHint = sport ? SPORT_HINTS[sport.toLowerCase()] : undefined;

  const pkg = await callReelJson(
    apiKey,
    [
      "You are Reel Coach, a sports highlight editor for a pickup-sports app.",
      "Return ONLY JSON of this shape:",
      '{"sport":"basketball","captions":["...","...","..."],"overlays":[{"at":"0:03","text":"..."}],"hashtags":["..."]}',
      "Rules:",
      "- captions: exactly 3 distinct scroll-stopping caption variants, each under 200 characters, may use 1-2 emoji, no hashtags inside them. Vary the angle: one hype/energy, one storytelling/context, one short and punchy. Do not number or label them.",
      "- overlays: 3 to 5 short on-screen text cards (max 30 characters each) tied to real moments in the clip; `at` is a timestamp like 0:04 or a moment name from the analysis.",
      "- hashtags: 5 to 8 hashtags without the leading #, mixing the sport, the play type, and pickup/highlight tags.",
      "- Never invent scores, stats, opponents, or player names. If a detail is unknown, stay general.",
      sportHint ? `- Sport voice: ${sportHint}` : "",
      opts.tone ? `- Tone requested by the athlete: ${opts.tone}` : "",
      `- ${reelStyleDirectives(reel.style_prefs).vibe}`,
      `- ${reelStyleDirectives(reel.style_prefs).overlay}`,
    ]
      .filter(Boolean)
      .join("\n"),
    ["Here is everything known about the reel:", buildReelGrounding(reel)].join("\n"),
    opts.session ?? null,
  );

  const overlays: ReelOverlay[] = Array.isArray(pkg.overlays)
    ? pkg.overlays
        .map((o: any) => ({
          at: String(o?.at ?? o?.timestamp ?? "").slice(0, 24),
          text: String(o?.text ?? o?.label ?? "").slice(0, 60),
        }))
        .filter((o: ReelOverlay) => o.text.length > 0)
        .slice(0, 6)
    : [];

  const hashtags: string[] = Array.isArray(pkg.hashtags)
    ? pkg.hashtags
        .map((h: unknown) => String(h).replace(/^#/, "").trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const captions: string[] = Array.isArray(pkg.captions)
    ? pkg.captions
        .map((c: unknown) => String(c).slice(0, 500).trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  // Back-compat: if the model returned a single caption, use it as variant 1.
  if (captions.length === 0 && pkg.caption) {
    captions.push(String(pkg.caption).slice(0, 500).trim());
  }
  const caption = captions[0] ?? "";

  if (!caption && overlays.length === 0 && hashtags.length === 0) {
    throw new Error("Reel Coach could not build a package — try again");
  }

  // Every AI-written string here can end up on a publicly visible reel, so it
  // passes the safety check before it is handed back. Blocked copy is dropped.
  let safeCaptions = captions;
  let safeOverlays = overlays;
  let safeHashtags = hashtags;
  if (opts.session) {
    const { moderateAiText } = await import("@/lib/ai/moderation.server");
    const verdict = await moderateAiText(opts.session.admin, {
      userId: opts.session.userId,
      jobId: opts.session.jobId,
      text: [...captions, ...overlays.map((o) => o.text), ...hashtags].join("\n"),
      context: "AI-written reel copy the athlete may publish",
      target: { table: "highlight_reels", id: String(reel.id ?? ""), field: "reel_package" },
    });
    if (verdict.verdict === "block") {
      safeCaptions = [];
      safeOverlays = [];
      safeHashtags = [];
    }
  }

  return {
    sport: pkg.sport ? String(pkg.sport).slice(0, 40) : sport,
    caption: safeCaptions[0] ?? "",
    captions: safeCaptions,
    overlays: safeOverlays,
    hashtags: safeHashtags,
  };
}
