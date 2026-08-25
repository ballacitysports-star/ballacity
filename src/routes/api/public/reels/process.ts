import { createFileRoute } from "@tanstack/react-router";

const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 10 * 60 * 1000;
const BATCH_SIZE = 5;

// Ordered pipeline. Each step reads/writes step_progress and advances processing_step.
// Retries resume from the first step that hasn't completed.
const STEPS = ["metadata", "hashtags", "thumbnail", "finalize"] as const;
type Step = (typeof STEPS)[number];

type Reel = {
  id: string;
  user_id: string;
  title: string;
  video_path: string;
  attempts: number;
  processing_step: string;
  step_progress: Record<string, any> | null;
  game_id: string | null;
};

async function callLovableAI(prompt: string, system: string, apiKey: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "manual-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!content) throw new Error("AI gateway returned no content");
  return JSON.parse(content);
}

// Each step receives accumulated progress and returns a patch merged into step_progress.
const STEP_RUNNERS: Record<Step, (reel: Reel, progress: any, apiKey: string) => Promise<any>> = {
  metadata: async (reel, _p, apiKey) => {
    const out = await callLovableAI(
      `Original filename/title: "${reel.title}". Generate an engaging title and caption for this sports highlight clip.`,
      'Respond ONLY with JSON: {"title":"...","caption":"..."}. Title max 60 chars, caption max 200 chars.',
      apiKey,
    );
    return {
      ai_title: String(out.title ?? "").slice(0, 120),
      ai_caption: String(out.caption ?? "").slice(0, 500),
    };
  },
  hashtags: async (_reel, progress, apiKey) => {
    const out = await callLovableAI(
      `Title: "${progress.ai_title}". Caption: "${progress.ai_caption}". Generate 3-5 trending hashtags.`,
      'Respond ONLY with JSON: {"hashtags":["..."]}. Max 8 hashtags, no leading #.',
      apiKey,
    );
    return {
      ai_hashtags: Array.isArray(out.hashtags)
        ? out.hashtags.map((h: unknown) => String(h)).slice(0, 8)
        : [],
    };
  },
  thumbnail: async (reel) => {
    // Placeholder: derive a thumbnail path from the source video.
    // Real thumbnail extraction would live here (ffmpeg/worker). Safe to retry.
    return { thumbnail_path: reel.video_path.replace(/\.[^.]+$/, "") + ".jpg" };
  },
  finalize: async () => ({ finalized_at: new Date().toISOString() }),
};

function nextStep(current: string): Step | null {
  if (current === "completed") return null;
  const idx = STEPS.indexOf(current as Step);
  return STEPS[idx + 1] ?? null;
}

function firstStep(current: string): Step {
  // "pending" or unknown → start at first step; otherwise resume at the step AFTER the last completed one.
  if (!STEPS.includes(current as Step)) return STEPS[0];
  const idx = STEPS.indexOf(current as Step);
  return STEPS[idx + 1] ?? STEPS[STEPS.length - 1];
}

async function processReel(reel: Reel, supabaseAdmin: any, apiKey: string) {
  const progress: Record<string, any> = { ...(reel.step_progress ?? {}) };
  const startStep = firstStep(reel.processing_step);
  const startIdx = STEPS.indexOf(startStep);
  const resumed = reel.processing_step !== "pending" && startIdx > 0;

  await supabaseAdmin
    .from("highlight_reels")
    .update({
      attempts: reel.attempts + 1,
      processing_started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", reel.id);

  try {
    for (let i = startIdx; i < STEPS.length; i++) {
      const step = STEPS[i];
      const patch = await STEP_RUNNERS[step](reel, progress, apiKey);
      Object.assign(progress, patch);
      await supabaseAdmin
        .from("highlight_reels")
        .update({
          processing_step: step,
          step_progress: progress,
          last_step_at: new Date().toISOString(),
        })
        .eq("id", reel.id);
    }

    await supabaseAdmin
      .from("highlight_reels")
      .update({
        status: "completed",
        processing_step: "completed",
        ai_title: progress.ai_title ?? null,
        ai_caption: progress.ai_caption ?? null,
        ai_hashtags: progress.ai_hashtags ?? [],
        thumbnail_path: progress.thumbnail_path ?? null,
        completed_at: new Date().toISOString(),
        error_message: null,
        failed_at: null,
      })
      .eq("id", reel.id);

    // Notify the owner that their highlight video is ready (in-app + push fanout).
    await supabaseAdmin.from("notifications").insert({
      user_id: reel.user_id,
      type: "reel_ready",
      title: "Your highlight reel is ready",
      body: progress.ai_title ? String(progress.ai_title) : reel.title,
      link: reel.game_id ? `/reels?game=${reel.game_id}` : "/reels",
    });

    return { id: reel.id, status: "completed", resumedFrom: resumed ? startStep : null };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const finalFail = reel.attempts + 1 >= MAX_ATTEMPTS;
    // Persist progress so the next attempt resumes from the failed step (not from scratch).
    await supabaseAdmin
      .from("highlight_reels")
      .update({
        status: finalFail ? "failed" : "processing",
        step_progress: progress,
        error_message: msg,
        failed_at: finalFail ? new Date().toISOString() : null,
        processing_started_at: null,
      })
      .eq("id", reel.id);
    if (finalFail) {
      await supabaseAdmin.from("notifications").insert({
        user_id: reel.user_id,
        type: "reel_failed",
        title: "Recap generation failed",
        body: `We couldn't finish "${reel.title}". Try generating it again.`,
        link: reel.game_id ? `/reels?game=${reel.game_id}` : "/reels",
      });
    }

    return { id: reel.id, status: finalFail ? "failed" : "retry-pending", error: msg };
  }
}

export const Route = createFileRoute("/api/public/reels/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Restrict this expensive endpoint to callers that present the shared
        // worker secret. Prevents anonymous internet visitors from burning
        // Lovable AI credits by hammering the URL.
        const workerSecret = process.env.REELS_WORKER_SECRET;
        if (workerSecret) {
          const provided =
            request.headers.get("x-worker-secret") ??
            request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
            "";
          if (provided !== workerSecret) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        } else {
          // Fail closed when the secret hasn't been configured yet.
          return new Response(
            JSON.stringify({ error: "REELS_WORKER_SECRET not configured" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }


        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
        const { data: reels, error } = await supabaseAdmin
          .from("highlight_reels")
          .select("id,user_id,title,video_path,attempts,processing_step,step_progress,game_id")
          .eq("status", "processing")
          .lt("attempts", MAX_ATTEMPTS)
          .or(`processing_started_at.is.null,processing_started_at.lt.${stuckBefore}`)
          .order("created_at", { ascending: true })
          .limit(BATCH_SIZE);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results = [];
        for (const r of (reels ?? []) as Reel[]) {
          results.push(await processReel(r, supabaseAdmin, apiKey));
        }

        return new Response(JSON.stringify({ processed: results.length, results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
