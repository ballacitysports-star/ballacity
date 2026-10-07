import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * User-facing controls over AI analyses of their own videos: view them, delete
 * the analysis while keeping the clip, or delete the clip and everything with
 * it. Every query is scoped to the caller's own rows.
 */

export type AiAnalysisSummary = {
  reelId: string;
  title: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  sport: string | null;
  aiTitle: string | null;
  aiCaption: string | null;
  hashtags: string[];
  coachingNotes: string[];
  /** Analyses can only be deleted once the pipeline is no longer working on them. */
  deletable: boolean;
  hasAnalysis: boolean;
};

const SELECT =
  "id,title,status,created_at,completed_at,ai_sport,ai_title,ai_caption,ai_hashtags,ai_coaching,ai_advanced_analytics,ai_analysis,ai_moments,ai_transcript";

function toNotes(coaching: unknown): string[] {
  if (Array.isArray(coaching)) {
    return coaching
      .map((c) =>
        typeof c === "string"
          ? c
          : typeof (c as { note?: string; text?: string })?.note === "string"
            ? (c as { note: string }).note
            : typeof (c as { text?: string })?.text === "string"
              ? (c as { text: string }).text
              : null,
      )
      .filter((n): n is string => !!n)
      .slice(0, 6);
  }
  return [];
}

/** Every AI analysis attached to the caller's clips. */
export const listMyAiAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiAnalysisSummary[]> => {
    const { data, error } = await context.supabase
      .from("highlight_reels")
      .select(SELECT)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    return ((data ?? []) as any[]).map((r) => ({
      reelId: r.id as string,
      title: (r.title as string) ?? "Untitled clip",
      status: (r.status as string) ?? "processing",
      createdAt: r.created_at as string,
      completedAt: (r.completed_at as string | null) ?? null,
      sport: (r.ai_sport as string | null) ?? null,
      aiTitle: (r.ai_title as string | null) ?? null,
      aiCaption: (r.ai_caption as string | null) ?? null,
      hashtags: Array.isArray(r.ai_hashtags) ? (r.ai_hashtags as string[]).slice(0, 12) : [],
      coachingNotes: toNotes(r.ai_coaching),
      deletable: r.status !== "processing",
      hasAnalysis: Boolean(
        r.ai_title ||
        r.ai_caption ||
        r.ai_analysis ||
        r.ai_coaching ||
        r.ai_advanced_analytics ||
        r.ai_moments,
      ),
    }));
  });

/**
 * Deletes the AI analysis for one of the caller's clips while keeping the video.
 * Also removes the derived material the analysis was made from (sampled frames
 * and the extracted audio) so nothing analyzable is left behind.
 */
export const deleteMyAiAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId };
  })
  .handler(async ({ data, context }) => {
    const { data: reel, error } = await context.supabase
      .from("highlight_reels")
      .select("id,status,audio_path,frame_paths")
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!reel) throw new Error("Clip not found");
    if ((reel as any).status === "processing") {
      throw new Error("This clip is still being analyzed — try again once it finishes.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const derived = [
      (reel as any).audio_path,
      ...((((reel as any).frame_paths as string[] | null) ?? []) as string[]),
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    if (derived.length > 0) {
      await supabaseAdmin.storage.from("highlight-videos").remove(derived);
    }

    const { error: updError } = await supabaseAdmin
      .from("highlight_reels")
      .update({
        ai_analysis: null,
        ai_caption: null,
        ai_coaching: null,
        ai_advanced_analytics: null,
        ai_edit_plan: null,
        ai_hashtags: null,
        ai_moments: null,
        ai_overlays: null,
        ai_sport: null,
        ai_timeline: null,
        ai_title: null,
        ai_transcript: null,
        suggested_clip: null,
        // The pipeline's working copy holds the same analysis (and analytics).
        step_progress: null,
        audio_path: null,
        frame_paths: null,
        frame_times: null,
        status: "analysis_deleted",
        processing_step: "completed",
        error_message: null,
      } as never)
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (updError) throw new Error(updError.message);
    return { deleted: true };
  });
