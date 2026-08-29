import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Runs the highlight-reel pipeline for the signed-in user's queued reels.
 *
 * Called right after an upload (so nothing sits in the queue) and from the
 * "Resume processing" button. Only the caller's own rows are ever touched.
 */
export const processMyReels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId?: string } | undefined) => ({
    reelId: typeof input?.reelId === "string" ? input.reelId : undefined,
  }))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured yet — please try again later");

    const { MAX_ATTEMPTS, REEL_WORK_COLUMNS, processReel } = await import(
      "@/lib/reels-pipeline.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("highlight_reels")
      .select(REEL_WORK_COLUMNS)
      .eq("user_id", context.userId)
      .in("status", ["processing", "failed"])
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(3);
    if (data.reelId) q = q.eq("id", data.reelId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const results = [];
    for (const reel of (rows ?? []) as any[]) {
      results.push(await processReel(reel, supabaseAdmin, apiKey));
    }
    return { processed: results.length, results };
  });

/**
 * Reel Coach: a conversational sports agent grounded in the AI analysis of one
 * of the caller's reels. Can rewrite the title/caption/hashtags on request.
 */
export const askReelCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      reelId: string;
      question: string;
      history?: { role: "user" | "assistant"; content: string }[];
    }) => {
      if (!input?.reelId) throw new Error("reelId is required");
      const question = String(input.question ?? "").trim();
      if (!question) throw new Error("Ask the coach something first");
      return {
        reelId: input.reelId,
        question: question.slice(0, 1000),
        history: (input.history ?? []).slice(-8),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured yet — please try again later");

    const { data: reel, error } = await context.supabase
      .from("highlight_reels")
      .select(
        "id,title,ai_title,ai_caption,ai_hashtags,ai_sport,ai_analysis,ai_moments,suggested_clip,game_title,status",
      )
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!reel) throw new Error("Reel not found");

    const r = reel as Record<string, any>;
    const grounding = [
      `Reel title: ${r.ai_title || r.title}`,
      r.game_title ? `Game: ${r.game_title}` : "",
      r.ai_sport ? `Sport: ${r.ai_sport}` : "",
      r.ai_caption ? `Current caption: ${r.ai_caption}` : "",
      (r.ai_hashtags ?? []).length ? `Hashtags: ${(r.ai_hashtags ?? []).join(", ")}` : "",
      r.ai_analysis?.summary ? `What the footage shows: ${r.ai_analysis.summary}` : "",
      r.ai_analysis?.quality_note ? `Footage quality: ${r.ai_analysis.quality_note}` : "",
      (r.ai_moments ?? []).length
        ? `Key moments: ${(r.ai_moments ?? []).map((m: any) => m.label).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

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
          {
            role: "system",
            content: [
              "You are Reel Coach, a friendly sports highlight editor inside a pickup-sports app.",
              "Help the athlete improve this reel: captions, titles, hashtags, which moment to feature, and how to film better next time.",
              "Be concrete and brief (max 120 words). Never invent scores, stats, or player names.",
              "Here is everything known about the reel:",
              grounding || "No AI analysis is available for this reel yet.",
            ].join("\n"),
          },
          ...data.history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: data.question },
        ],
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
    const answer = String(json?.choices?.[0]?.message?.content ?? "").trim();
    if (!answer) throw new Error("Reel Coach had nothing to say — try rephrasing");
    return { answer };
  });

/** Applies a coach-suggested title/caption/hashtag rewrite to the caller's reel. */
export const applyReelCopy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; title?: string; caption?: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return {
      reelId: input.reelId,
      title: input.title ? String(input.title).slice(0, 120) : undefined,
      caption: input.caption ? String(input.caption).slice(0, 500) : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = {};
    if (data.title) patch.ai_title = data.title;
    if (data.caption) patch.ai_caption = data.caption;
    if (Object.keys(patch).length === 0) return { updated: false };
    const { error } = await context.supabase
      .from("highlight_reels")
      .update(patch as any)
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { updated: true };
  });
