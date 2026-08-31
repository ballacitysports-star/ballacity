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

/**
 * Re-runs the style-dependent AI steps (timeline, edit plan, coaching, title,
 * caption, hashtags, overlays) for a completed reel using the SAME captured
 * media — frames and audio are not re-read. Only the reel's owner can restyle.
 */
export const regenerateReelStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; style?: unknown }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId, style: normalizeReelStyle(input.style) };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured yet — please try again later");

    const { MAX_ATTEMPTS, REEL_WORK_COLUMNS, prepareStyleRegen, processReel } = await import(
      "@/lib/reels-pipeline.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: reel, error } = await supabaseAdmin
      .from("highlight_reels")
      .select(`${REEL_WORK_COLUMNS},status`)
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!reel) throw new Error("Reel not found");
    if ((reel as any).status !== "completed") {
      throw new Error("Only finished reels can be restyled — let this one finish first");
    }
    const progress = ((reel as any).step_progress ?? {}) as Record<string, any>;
    if (!progress.analysis && !(progress.moments ?? []).length && !progress.transcript) {
      throw new Error("This reel has no captured analysis to build on — use Try again instead");
    }

    const regen = prepareStyleRegen(progress);
    const { error: upErr } = await supabaseAdmin
      .from("highlight_reels")
      .update({
        style_prefs: data.style as any,
        status: "processing",
        processing_step: regen.processing_step,
        step_progress: regen.step_progress,
        attempts: 0,
        error_message: null,
        ai_title: null,
        ai_caption: null,
        ai_hashtags: [],
        ai_overlays: null,
        ai_timeline: [],
        ai_edit_plan: null,
        ai_coaching: null,
        thumbnail_path: null,
      } as any)
      .eq("id", reel.id);
    if (upErr) throw new Error(upErr.message);

    const result = await processReel(
      { ...reel, attempts: 0, processing_step: regen.processing_step, step_progress: regen.step_progress, style_prefs: data.style },
      supabaseAdmin,
      apiKey,
    );

    // Fresh overlays in the new style, timed to the regenerated timeline.
    if (result.status === "completed") {
      try {
        const { REEL_COACH_COLUMNS, generateReelPackage } = await import(
          "@/lib/reel-coach.server"
        );
        const { data: fresh } = await supabaseAdmin
          .from("highlight_reels")
          .select(REEL_COACH_COLUMNS)
          .eq("id", reel.id)
          .maybeSingle();
        if (fresh) {
          const pkg = await generateReelPackage(apiKey, fresh as Record<string, any>);
          if (pkg.overlays.length > 0) {
            await supabaseAdmin
              .from("highlight_reels")
              .update({ ai_overlays: pkg.overlays as any })
              .eq("id", reel.id);
          }
        }
      } catch {
        // Overlays are a bonus — the restyled reel is already saved.
      }
    }

    return { ...result, style: data.style, attemptsLimit: MAX_ATTEMPTS };
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

/**
 * Compare mode: builds a restyled DRAFT of a finished reel in memory and returns
 * it without changing the stored reel, so the athlete can preview the current
 * version side by side with the restyled one before publishing.
 */
export const previewReelStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; style?: unknown }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId, style: normalizeReelStyle(input.style) };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured yet — please try again later");

    const { REEL_WORK_COLUMNS, runStyleDraft } = await import("@/lib/reels-pipeline.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: reel, error } = await supabaseAdmin
      .from("highlight_reels")
      .select(`${REEL_WORK_COLUMNS},status`)
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!reel) throw new Error("Reel not found");
    if ((reel as any).status !== "completed") {
      throw new Error("Only finished reels can be compared — let this one finish first");
    }
    const progress = ((reel as any).step_progress ?? {}) as Record<string, any>;
    if (!progress.analysis && !(progress.moments ?? []).length && !progress.transcript) {
      throw new Error("This reel has no captured analysis to build on — use Try again instead");
    }

    return runStyleDraft(reel as any, data.style as any, supabaseAdmin, apiKey);
  });

/**
 * Publishes a previewed restyle: writes the drafted copy, timeline, edit plan,
 * coaching, overlays, thumbnail and style onto the caller's reel. No AI re-run —
 * the athlete already saw exactly this version in compare mode.
 */
export const applyReelStyleDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; draft: any }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    const d = input?.draft;
    if (!d || typeof d !== "object") throw new Error("Generate a preview first");
    return {
      reelId: input.reelId,
      style: normalizeReelStyle(d.style),
      ai_title: d.ai_title ? String(d.ai_title).slice(0, 120) : null,
      ai_caption: d.ai_caption ? String(d.ai_caption).slice(0, 500) : null,
      ai_hashtags: Array.isArray(d.ai_hashtags)
        ? d.ai_hashtags.map((h: unknown) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 8)
        : [],
      timeline: Array.isArray(d.timeline) ? d.timeline.slice(0, 8) : [],
      edit_plan: d.edit_plan ?? null,
      coaching: d.coaching ?? null,
      overlays: Array.isArray(d.overlays) ? d.overlays.slice(0, 6) : [],
      thumbnail_path: d.thumbnail_path ? String(d.thumbnail_path) : null,
    };
  })
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = {
      style_prefs: data.style,
      ai_title: data.ai_title,
      ai_caption: data.ai_caption,
      ai_hashtags: data.ai_hashtags,
      ai_timeline: data.timeline,
      ai_edit_plan: data.edit_plan,
      ai_coaching: data.coaching,
    };
    if (data.overlays.length) patch.ai_overlays = data.overlays;
    if (data.thumbnail_path) patch.thumbnail_path = data.thumbnail_path;

    const { error } = await context.supabase
      .from("highlight_reels")
      .update(patch as any)
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { published: true, style: data.style };
  });

/** Hides or re-shows one of the caller's reels on their profile card. */
export const setReelHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; hidden: boolean }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId, hidden: input.hidden === true };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("highlight_reels")
      .update({ hidden_at: data.hidden ? new Date().toISOString() : null } as any)
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { hidden: data.hidden };
  });

/**
 * Records the widely-playable H.264 copy for one of the caller's reels.
 * Used by the in-browser repair flow for clips uploaded before automatic
 * transcoding existed (VP9/AV1 in .mp4 that Safari/iOS can't decode).
 */
export const setReelPlaybackPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; playbackPath: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    if (!input?.playbackPath) throw new Error("playbackPath is required");
    return { reelId: input.reelId, playbackPath: input.playbackPath };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("highlight_reels")
      .update({ playback_path: data.playbackPath } as any)
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { playbackPath: data.playbackPath };
  });

/**
 * Permanently deletes one of the caller's reels: removes the stored video,
 * thumbnail, audio, and captured frames, then the row itself.
 */
export const deleteReel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reel, error } = await supabaseAdmin
      .from("highlight_reels")
      .select("id,user_id,video_path,thumbnail_path,audio_path,frame_paths")
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!reel) throw new Error("Reel not found");

    const paths = [
      (reel as any).video_path,
      (reel as any).thumbnail_path,
      (reel as any).audio_path,
      ...(((reel as any).frame_paths as string[] | null) ?? []),
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length > 0) {
      await supabaseAdmin.storage.from("highlight-videos").remove(paths);
    }

    const { error: delError } = await supabaseAdmin
      .from("highlight_reels")
      .delete()
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (delError) throw new Error(delError.message);
    return { deleted: true };
  });

/** Games the caller can attach a reel to: ones they host or joined. */
export const listAttachableGames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: hosted } = await context.supabase
      .from("hosted_games")
      .select("id,title,sport,date")
      .eq("host_id", context.userId)
      .order("date", { ascending: false })
      .limit(60);

    const { data: joins } = await context.supabase
      .from("game_participants")
      .select("game_id")
      .eq("user_id", context.userId)
      .limit(120);

    const joinedIds = ((joins ?? []) as any[])
      .map((r) => r.game_id as string)
      .filter((id) => !((hosted ?? []) as any[]).some((g) => g.id === id));

    let joined: any[] = [];
    if (joinedIds.length > 0) {
      const { data } = await context.supabase
        .from("hosted_games")
        .select("id,title,sport,date")
        .in("id", joinedIds)
        .order("date", { ascending: false });
      joined = (data ?? []) as any[];
    }

    const seen = new Set<string>();
    return [...((hosted ?? []) as any[]), ...joined]
      .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
      .map((g) => ({
        id: g.id as string,
        title: (g.title as string) ?? "Game",
        sport: (g.sport as string) ?? null,
        date: (g.date as string) ?? null,
      }));
  });

/** Links a game-less reel to a game (or clears the link when gameId is empty). */
export const attachReelToGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; gameId: string | null }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    const gameId = typeof input.gameId === "string" && input.gameId ? input.gameId : null;
    return { reelId: input.reelId, gameId };
  })
  .handler(async ({ data, context }) => {
    let patch: Record<string, unknown> = { game_id: null, game_title: null };
    if (data.gameId) {
      const { data: game, error: gErr } = await context.supabase
        .from("hosted_games")
        .select("id,title")
        .eq("id", data.gameId)
        .maybeSingle();
      if (gErr) throw new Error(gErr.message);
      if (!game) throw new Error("That game is no longer available");
      patch = { game_id: (game as any).id, game_title: (game as any).title };
    }

    const { error } = await context.supabase
      .from("highlight_reels")
      .update(patch as any)
      .eq("id", data.reelId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { gameId: data.gameId };
  });

/** Hides or re-shows several of the caller's reels in one request. */
export const setReelsHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelIds: string[]; hidden: boolean }) => {
    const reelIds = Array.isArray(input?.reelIds) ? input.reelIds.filter(Boolean) : [];
    if (reelIds.length === 0) throw new Error("Select at least one reel");
    return { reelIds: reelIds.slice(0, 100), hidden: input.hidden === true };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("highlight_reels")
      .update({ hidden_at: data.hidden ? new Date().toISOString() : null } as any)
      .in("id", data.reelIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { updated: data.reelIds.length, hidden: data.hidden };
  });

/**
 * Public, read-only list of a user's visible completed reels for the public
 * player card. Signed URLs are minted server-side because the storage bucket
 * only allows owners to read objects directly. No auth required — the rows
 * are gated by the "Anyone can view visible completed reels" policy and this
 * function applies the same filter itself.
 */
export const listPublicReels = createServerFn({ method: "GET" })
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId || typeof input.userId !== "string") {
      throw new Error("userId is required");
    }
    return { userId: input.userId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { RECAP_COLUMNS } = await import("@/lib/recaps");

    const { data: rows, error } = await supabaseAdmin
      .from("highlight_reels")
      .select(RECAP_COLUMNS)
      .eq("user_id", data.userId)
      .eq("status", "completed")
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(error.message);

    const reels = (rows ?? []) as any[];
    return Promise.all(
      reels.map(async (r) => {
        const [video, original, thumb] = await Promise.all([
          supabaseAdmin.storage.from("highlight-videos").createSignedUrl(r.playback_path ?? r.video_path, 3600),
          r.playback_path
            ? supabaseAdmin.storage.from("highlight-videos").createSignedUrl(r.video_path, 3600)
            : Promise.resolve({ data: null }),
          r.thumbnail_path
            ? supabaseAdmin.storage.from("highlight-videos").createSignedUrl(r.thumbnail_path, 3600)
            : Promise.resolve({ data: null }),
        ]);
        return {
          id: r.id as string,
          title: (r.ai_title as string) || (r.title as string),
          videoUrl: video.data?.signedUrl ?? null,
          /** Original upload, tried automatically if the primary copy won't decode. */
          fallbackVideoUrl: (original as any)?.data?.signedUrl ?? null,
          thumbnailUrl: (thumb as any).data?.signedUrl ?? null,
          sport: (r.ai_sport as string) ?? null,
          caption: (r.ai_caption as string) ?? null,
          hashtags: (r.ai_hashtags as string[]) ?? [],
          gameTitle: (r.game_title as string) ?? null,
          createdAt: r.created_at as string,
        };
      }),
    );
  });

/** Permanently deletes several of the caller's reels, media included. */
export const deleteReels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelIds: string[] }) => {
    const reelIds = Array.isArray(input?.reelIds) ? input.reelIds.filter(Boolean) : [];
    if (reelIds.length === 0) throw new Error("Select at least one reel");
    return { reelIds: reelIds.slice(0, 100) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("highlight_reels")
      .select("id,video_path,playback_path,thumbnail_path,audio_path,frame_paths")
      .in("id", data.reelIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    const ids = ((rows ?? []) as any[]).map((r) => r.id as string);
    if (ids.length === 0) return { deleted: 0 };

    const paths = ((rows ?? []) as any[])
      .flatMap((r) => [r.video_path, r.playback_path, r.thumbnail_path, r.audio_path, ...((r.frame_paths as string[] | null) ?? [])])
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length > 0) await supabaseAdmin.storage.from("highlight-videos").remove(paths);

    const { error: delError } = await supabaseAdmin
      .from("highlight_reels")
      .delete()
      .in("id", ids)
      .eq("user_id", context.userId);
    if (delError) throw new Error(delError.message);
    return { deleted: ids.length };
  });

/**
 * Best guess at the game a freshly uploaded clip belongs to.
 *
 * Uploads rarely happen from the game screen, so we pick the caller's closest
 * game in time (hosted or joined) — recently finished ones first — and hand the
 * uploader its title, sport, and kickoff so the reel is linked automatically and
 * the public player card shows the right sport and timing.
 */
export const suggestGameForReel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { at?: string } | undefined) => ({
    at: typeof input?.at === "string" && input.at ? input.at : null,
  }))
  .handler(async ({ data, context }) => {
    const at = data.at ? new Date(data.at) : new Date();
    const anchor = Number.isNaN(at.getTime()) ? new Date() : at;

    const [{ data: hosted }, { data: joins }] = await Promise.all([
      context.supabase
        .from("hosted_games")
        .select("id,title,sport,date")
        .eq("host_id", context.userId)
        .order("date", { ascending: false })
        .limit(40),
      context.supabase
        .from("game_participants")
        .select("game_id")
        .eq("user_id", context.userId)
        .limit(120),
    ]);

    const hostedRows = ((hosted ?? []) as any[]).map((g) => ({ ...g }));
    const joinedIds = ((joins ?? []) as any[])
      .map((r) => r.game_id as string)
      .filter((id) => !hostedRows.some((g) => g.id === id));

    let joinedRows: any[] = [];
    if (joinedIds.length > 0) {
      const { data: rows } = await context.supabase
        .from("hosted_games")
        .select("id,title,sport,date")
        .in("id", joinedIds)
        .order("date", { ascending: false })
        .limit(40);
      joinedRows = (rows ?? []) as any[];
    }

    // Within 14 days before the upload (or 1 day after, for early uploads).
    const WINDOW_BEFORE = 14 * 24 * 60 * 60 * 1000;
    const WINDOW_AFTER = 24 * 60 * 60 * 1000;
    const candidates = [...hostedRows, ...joinedRows]
      .filter((g) => typeof g.date === "string")
      .map((g) => {
        const delta = anchor.getTime() - new Date(g.date as string).getTime();
        return { g, delta };
      })
      .filter(({ delta }) => delta >= -WINDOW_AFTER && delta <= WINDOW_BEFORE)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));

    const best = candidates[0]?.g;
    if (!best) return null;
    return {
      id: best.id as string,
      title: (best.title as string) ?? "Game",
      sport: (best.sport as string) ?? null,
      date: (best.date as string) ?? null,
    };
  });
