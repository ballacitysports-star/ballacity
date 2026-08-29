/**
 * Shared highlight-reel processing pipeline.
 *
 * Used by both the batch worker route (`/api/public/reels/process`, which sweeps
 * abandoned rows) and the authenticated `processMyReels` server function (which
 * runs right after upload so a reel never sits in the queue).
 *
 * Each step writes its patch into `step_progress` and advances `processing_step`,
 * so a retry resumes from the first step that never completed.
 */

export const MAX_ATTEMPTS = 3;
export const STUCK_AFTER_MS = 10 * 60 * 1000;
export const BATCH_SIZE = 5;

export const STEPS = ["analyze", "metadata", "hashtags", "thumbnail", "finalize"] as const;
export type Step = (typeof STEPS)[number];

export type Reel = {
  id: string;
  user_id: string;
  title: string;
  video_path: string;
  attempts: number;
  processing_step: string;
  step_progress: Record<string, any> | null;
  game_id: string | null;
  game_title?: string | null;
  frame_paths?: string[] | null;
};

export const REEL_WORK_COLUMNS =
  "id,user_id,title,video_path,attempts,processing_step,step_progress,game_id,game_title,frame_paths";

async function callLovableAI(prompt: string, system: string, apiKey: string) {
  return callLovableAIParts([{ type: "text", text: prompt }], system, apiKey);
}

/** Multimodal-capable gateway call that always returns parsed JSON. */
async function callLovableAIParts(
  parts: Array<Record<string, any>>,
  system: string,
  apiKey: string,
) {
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
        { role: "user", content: parts },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("AI is rate limited — retrying shortly");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits to continue");
    throw new Error(`AI gateway ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!content) throw new Error("AI gateway returned no content");
  return JSON.parse(content);
}

/** Downloads a storage object and returns it as a base64 data URL for the gateway. */
async function frameDataUrl(supabaseAdmin: any, path: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.storage.from("highlight-videos").download(path);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    if (buf.byteLength > 6 * 1024 * 1024) return null;
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

type StepCtx = { supabaseAdmin: any; apiKey: string };

const STEP_RUNNERS: Record<
  Step,
  (reel: Reel, progress: any, ctx: StepCtx) => Promise<Record<string, any>>
> = {
  /**
   * The sports agent: looks at frames sampled from the clip in the browser and
   * describes what actually happens, so every later step writes from real
   * content instead of the filename. Degrades to filename-only when no frames
   * were captured (older uploads, unsupported browsers).
   */
  analyze: async (reel, _p, { supabaseAdmin, apiKey }) => {
    const paths = (reel.frame_paths ?? []).slice(0, 4);
    const images: string[] = [];
    for (const p of paths) {
      const url = await frameDataUrl(supabaseAdmin, p);
      if (url) images.push(url);
    }
    if (images.length === 0) {
      return { analysis: null, moments: [], sport: null, suggested_clip: null };
    }
    const parts: Array<Record<string, any>> = [
      {
        type: "text",
        text: `These frames are sampled evenly across a sports highlight clip titled "${reel.title}"${
          reel.game_title ? ` from the game "${reel.game_title}"` : ""
        }. Frame 1 is near the start, the last frame near the end. Describe what is happening.`,
      },
      ...images.map((url) => ({ type: "image_url", image_url: { url } })),
    ];
    const out = await callLovableAIParts(
      parts,
      [
        "You are a sports video analyst. Respond ONLY with JSON:",
        '{"sport":"basketball|football|soccer|baseball|softball|volleyball|tennis|pickleball|running|other",',
        '"summary":"2 sentences on what happens","moments":[{"label":"short play name","frame":1,"note":"one line"}],',
        '"suggested_clip":{"start_pct":0,"end_pct":100,"why":"one line"},"quality_note":"one line on lighting/shake/framing"}',
        "Max 5 moments. Never invent scores or player names.",
      ].join(" "),
      apiKey,
    );
    const moments = Array.isArray(out.moments)
      ? out.moments.slice(0, 5).map((m: any) => ({
          label: String(m?.label ?? "Highlight").slice(0, 60),
          frame: Number(m?.frame) || 1,
          note: String(m?.note ?? "").slice(0, 160),
        }))
      : [];
    return {
      sport: out.sport ? String(out.sport).slice(0, 40) : null,
      moments,
      analysis: {
        summary: String(out.summary ?? "").slice(0, 600),
        quality_note: String(out.quality_note ?? "").slice(0, 300),
        frames: images.length,
      },
      suggested_clip: out.suggested_clip
        ? {
            start_pct: Math.max(0, Math.min(100, Number(out.suggested_clip.start_pct) || 0)),
            end_pct: Math.max(0, Math.min(100, Number(out.suggested_clip.end_pct) || 100)),
            why: String(out.suggested_clip.why ?? "").slice(0, 200),
          }
        : null,
    };
  },
  metadata: async (reel, progress, { apiKey }) => {
    const context = progress.analysis?.summary
      ? `What the footage shows: ${progress.analysis.summary}. Detected sport: ${progress.sport ?? "unknown"}. Key moments: ${(
          progress.moments ?? []
        )
          .map((m: any) => m.label)
          .join(", ")}.`
      : "";
    const out = await callLovableAI(
      `Original filename/title: "${reel.title}". ${context} Generate an engaging title and caption for this sports highlight clip.`,
      'Respond ONLY with JSON: {"title":"...","caption":"..."}. Title max 60 chars, caption max 200 chars.',
      apiKey,
    );
    return {
      ai_title: String(out.title ?? "").slice(0, 120),
      ai_caption: String(out.caption ?? "").slice(0, 500),
    };
  },
  hashtags: async (_reel, progress, { apiKey }) => {
    const out = await callLovableAI(
      `Title: "${progress.ai_title}". Caption: "${progress.ai_caption}". Sport: ${
        progress.sport ?? "unknown"
      }. Generate 3-5 trending hashtags.`,
      'Respond ONLY with JSON: {"hashtags":["..."]}. Max 8 hashtags, no leading #.',
      apiKey,
    );
    return {
      ai_hashtags: Array.isArray(out.hashtags)
        ? out.hashtags.map((h: unknown) => String(h)).slice(0, 8)
        : [],
    };
  },
  /** Real thumbnail: the browser captured frames at upload time. */
  thumbnail: async (reel, progress) => {
    const frames = reel.frame_paths ?? [];
    if (frames.length === 0) return { thumbnail_path: null };
    const moments = (progress.moments ?? []) as { frame?: number }[];
    const best = moments[0]?.frame;
    const idx = best && best >= 1 && best <= frames.length ? best - 1 : 0;
    return { thumbnail_path: frames[idx] ?? frames[0] };
  },
  finalize: async () => ({ finalized_at: new Date().toISOString() }),
};

function firstStep(current: string): Step {
  // "pending"/unknown → start at the first step; otherwise resume after the last completed one.
  if (!STEPS.includes(current as Step)) return STEPS[0];
  const idx = STEPS.indexOf(current as Step);
  return STEPS[idx + 1] ?? STEPS[STEPS.length - 1];
}

/**
 * Live progress snapshot the UI reads while the pipeline runs.
 * `processing_step` only advances once a step *finishes* (so retries resume
 * correctly), so the currently-running step and percent live here instead.
 */
export type PipelineSnapshot = {
  active: Step | null;
  done: Step[];
  failed?: Step | null;
  percent: number;
  attempt: number;
  updated_at: string;
};

function snapshot(
  done: Step[],
  active: Step | null,
  attempt: number,
  failed?: Step | null,
): PipelineSnapshot {
  // Half credit for the step in flight so the bar always moves.
  const units = done.length + (active ? 0.5 : 0);
  return {
    active,
    done,
    failed: failed ?? null,
    percent: Math.min(99, Math.max(4, Math.round((units / STEPS.length) * 100))),
    attempt,
    updated_at: new Date().toISOString(),
  };
}

export async function processReel(reel: Reel, supabaseAdmin: any, apiKey: string) {
  const progress: Record<string, any> = { ...(reel.step_progress ?? {}) };
  const startStep = firstStep(reel.processing_step);
  const startIdx = STEPS.indexOf(startStep);
  const resumed = reel.processing_step !== "pending" && startIdx > 0;
  const attempt = reel.attempts + 1;
  const done: Step[] = STEPS.slice(0, startIdx);

  progress._pipeline = snapshot(done, startStep, attempt);

  await supabaseAdmin
    .from("highlight_reels")
    .update({
      attempts: attempt,
      processing_started_at: new Date().toISOString(),
      step_progress: progress,
      last_step_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", reel.id);

  try {
    for (let i = startIdx; i < STEPS.length; i++) {
      const step = STEPS[i];
      // Announce the step *before* running it so the card shows what's happening now.
      progress._pipeline = snapshot(done, step, attempt);
      await supabaseAdmin
        .from("highlight_reels")
        .update({ step_progress: progress, last_step_at: new Date().toISOString() })
        .eq("id", reel.id);

      const patch = await STEP_RUNNERS[step](reel, progress, { supabaseAdmin, apiKey });
      Object.assign(progress, patch);
      done.push(step);
      progress._pipeline = snapshot(done, STEPS[i + 1] ?? null, attempt);
      await supabaseAdmin
        .from("highlight_reels")
        .update({
          processing_step: step,
          step_progress: progress,
          last_step_at: new Date().toISOString(),
        })
        .eq("id", reel.id);
    }

    progress._pipeline = { ...snapshot(done, null, attempt), percent: 100 };

    await supabaseAdmin
      .from("highlight_reels")
      .update({
        status: "completed",
        processing_step: "completed",
        step_progress: progress,

        ai_title: progress.ai_title ?? null,
        ai_caption: progress.ai_caption ?? null,
        ai_hashtags: progress.ai_hashtags ?? [],
        thumbnail_path: progress.thumbnail_path ?? null,
        ai_sport: progress.sport ?? null,
        ai_moments: progress.moments ?? [],
        ai_analysis: progress.analysis ?? null,
        suggested_clip: progress.suggested_clip ?? null,
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
    const failedStep = (progress._pipeline?.active ?? null) as Step | null;
    progress._pipeline = snapshot(done, null, attempt, failedStep);
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
