/**
 * Server-only helpers for the Reel Coach sports agent.
 *
 * Keeps the grounding text and the "reel package" generation (caption +
 * on-screen text moments + hashtags) out of the server-function module, which
 * must stay a thin wrapper.
 */

export const REEL_COACH_COLUMNS =
  "id,title,ai_title,ai_caption,ai_hashtags,ai_sport,ai_analysis,ai_moments,suggested_clip,game_title,status";

export type ReelOverlay = {
  /** Where the text should appear, e.g. "0:03" or "the dunk". */
  at: string;
  /** Short on-screen text (kept punchy so it reads on a phone). */
  text: string;
};

export type ReelPackage = {
  sport: string | null;
  caption: string;
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
    r.suggested_clip?.start != null
      ? `Suggested clip window: ${r.suggested_clip.start}s to ${r.suggested_clip.end}s`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Chat-completions call that returns parsed JSON, with gateway error mapping. */
export async function callReelJson(
  apiKey: string,
  system: string,
  user: string,
): Promise<Record<string, any>> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("Reel Coach is busy — try again in a moment");
    if (res.status === 402)
      throw new Error("AI credits exhausted — add credits to keep using Reel Coach");
    const body = await res.text().catch(() => "");
    throw new Error(`Reel Coach failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = String(json?.choices?.[0]?.message?.content ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!content) throw new Error("Reel Coach had nothing to say — try again");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Reel Coach returned an unreadable answer — try again");
  }
}

const SPORT_HINTS: Record<string, string> = {
  basketball:
    "Use hoops language (bucket, handles, and-1, dime, poster) and reference court actions only if the footage shows them.",
  football:
    "Use football language (route, pocket, snag, six) and stay accurate about pass vs run.",
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
  opts: { tone?: string } = {},
): Promise<ReelPackage> {
  const sport = reel.ai_sport ? String(reel.ai_sport) : null;
  const sportHint = sport ? SPORT_HINTS[sport.toLowerCase()] : undefined;

  const pkg = await callReelJson(
    apiKey,
    [
      "You are Reel Coach, a sports highlight editor for a pickup-sports app.",
      "Return ONLY JSON of this shape:",
      '{"sport":"basketball","caption":"...","overlays":[{"at":"0:03","text":"..."}],"hashtags":["..."]}',
      "Rules:",
      "- caption: one scroll-stopping caption under 200 characters, may use 1-2 emoji, no hashtags inside it.",
      "- overlays: 3 to 5 short on-screen text cards (max 30 characters each) tied to real moments in the clip; `at` is a timestamp like 0:04 or a moment name from the analysis.",
      "- hashtags: 5 to 8 hashtags without the leading #, mixing the sport, the play type, and pickup/highlight tags.",
      "- Never invent scores, stats, opponents, or player names. If a detail is unknown, stay general.",
      sportHint ? `- Sport voice: ${sportHint}` : "",
      opts.tone ? `- Tone requested by the athlete: ${opts.tone}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    ["Here is everything known about the reel:", buildReelGrounding(reel)].join("\n"),
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

  const caption = String(pkg.caption ?? "").slice(0, 500).trim();
  if (!caption && overlays.length === 0 && hashtags.length === 0) {
    throw new Error("Reel Coach could not build a package — try again");
  }

  return {
    sport: pkg.sport ? String(pkg.sport).slice(0, 40) : sport,
    caption,
    overlays,
    hashtags,
  };
}
