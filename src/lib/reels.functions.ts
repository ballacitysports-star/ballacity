import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeReelStyle } from "@/lib/reel-style";

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

    const { runReelCoachAgent } = await import("@/lib/reel-agent.server");
    return runReelCoachAgent(apiKey, {
      supabase: context.supabase,
      userId: context.userId,
      reelId: data.reelId,
      question: data.question,
      history: data.history,
    });
  });

/**
 * Builds a publish-ready package for one of the caller's reels: an optimized
 * caption, on-screen text moments tied to the footage, and sport-tailored
 * hashtags. Read-only — the athlete applies it explicitly.
 */
export const buildReelPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; tone?: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return {
      reelId: input.reelId,
      tone: input.tone ? String(input.tone).slice(0, 120) : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured yet — please try again later");

    const { REEL_COACH_COLUMNS, generateReelPackage } = await import("@/lib/reel-coach.server");
    const { data: reel, error } = await context.supabase
      .from("highlight_reels")
      .select(REEL_COACH_COLUMNS)
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!reel) throw new Error("Reel not found");

    return generateReelPackage(apiKey, reel as Record<string, any>, { tone: data.tone });
  });

/** Applies a coach-suggested title/caption/hashtag rewrite to the caller's reel. */
export const applyReelCopy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      reelId: string;
      title?: string;
      caption?: string;
      hashtags?: string[];
      overlays?: { at: string; text: string }[];
    }) => {
      if (!input?.reelId) throw new Error("reelId is required");
      return {
        reelId: input.reelId,
        title: input.title ? String(input.title).slice(0, 120) : undefined,
        caption: input.caption ? String(input.caption).slice(0, 500) : undefined,
        hashtags: Array.isArray(input.hashtags)
          ? input.hashtags
              .map((h) => String(h).replace(/^#/, "").trim())
              .filter(Boolean)
              .slice(0, 8)
          : undefined,
        overlays: Array.isArray(input.overlays)
          ? input.overlays
              .map((o) => ({
                at: String(o?.at ?? "").slice(0, 24),
                text: String(o?.text ?? "").slice(0, 60),
              }))
              .filter((o) => o.text.length > 0)
              .slice(0, 6)
          : undefined,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = {};
    if (data.title) patch.ai_title = data.title;
    if (data.caption) patch.ai_caption = data.caption;
    if (data.hashtags?.length) patch.ai_hashtags = data.hashtags;
    if (data.overlays?.length) patch.ai_overlays = data.overlays;
    if (Object.keys(patch).length === 0) return { updated: false };
    const { error } = await context.supabase
      .from("highlight_reels")
      .update(patch as any)
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { updated: true };
  });
