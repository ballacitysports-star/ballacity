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

import { reelStyleDirectives } from "@/lib/reel-style";
import { DEFAULT_AI_PROVIDER } from "@/lib/ai/config";
import { runAiCall, type AiSession } from "@/lib/ai/gate.server";
import { createLovableGatewayProvider } from "@/lib/ai/gateway.server";
import type { AiMessagePart } from "@/lib/ai/provider";

export const MAX_ATTEMPTS = 3;
export const STUCK_AFTER_MS = 10 * 60 * 1000;
export const BATCH_SIZE = 5;

export const STEPS = [
  "analyze",
  "transcribe",
  "timeline",
  "editplan",
  "coach",
  "metadata",
  "hashtags",
  "thumbnail",
  "finalize",
] as const;
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
  frame_times?: number[] | null;
  audio_path?: string | null;
  style_prefs?: Record<string, any> | null;
};

export const REEL_WORK_COLUMNS =
  "id,user_id,title,video_path,attempts,processing_step,step_progress,game_id,game_title,frame_paths,frame_times,audio_path,style_prefs";

async function callLovableAI(prompt: string, system: string, ctx: StepCtx) {
  return callLovableAIParts([{ type: "text", text: prompt }], system, ctx);
}

/**
 * Multimodal JSON call. Routed through the shared AI service layer so the model
 * name, retry policy, usage accounting and error mapping are the same for every
 * feature in the app. Prompts and outputs are unchanged from before the layer.
 */
async function callLovableAIParts(
  parts: Array<Record<string, any>>,
  system: string,
  ctx: StepCtx,
): Promise<any> {
  const request = { system, prompt: "", parts: parts as AiMessagePart[] };
  if (ctx.session) {
    const out = await runAiCall(ctx.session, (provider) => provider.generateStructured(request));
    return out.data;
  }
  const provider = createLovableGatewayProvider(DEFAULT_AI_PROVIDER);
  return (await provider.generateStructured(request)).data;
}

/** Downloads a storage object and returns it as a base64 data URL for the gateway. */
export async function frameDataUrl(
  supabaseAdmin: any,
  ownerId: string,
  path: string,
): Promise<string | null> {
  try {
    const { isOwnedMediaPath } = await import("@/lib/media-path-guard");
    if (!isOwnedMediaPath(ownerId, path)) return null;
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

/** Downloads the extracted WAV and returns raw base64 (no data: prefix). */
async function audioBase64(
  supabaseAdmin: any,
  ownerId: string,
  path: string,
): Promise<string | null> {
  try {
    const { isOwnedMediaPath } = await import("@/lib/media-path-guard");
    if (!isOwnedMediaPath(ownerId, path)) return null;
    const { data, error } = await supabaseAdmin.storage.from("highlight-videos").download(path);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    if (buf.byteLength > 8 * 1024 * 1024) return null;
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return btoa(binary);
  } catch {
    return null;
  }
}

type StepCtx = { supabaseAdmin: any; apiKey: string; session?: AiSession | null };

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
  analyze: async (reel, _p, ctx) => {
    const { supabaseAdmin } = ctx;
    // Denser sampling: up to 10 frames, spread across whatever the browser captured.
    const all = reel.frame_paths ?? [];
    const times = reel.frame_times ?? [];
    const stride = Math.max(1, Math.ceil(all.length / 10));
    const picked: { path: string; t: number | null; index: number }[] = [];
    for (let i = 0; i < all.length; i += stride) {
      picked.push({ path: all[i], t: times[i] ?? null, index: i + 1 });
    }

    const images: { url: string; t: number | null; index: number }[] = [];
    for (const p of picked) {
      const url = await frameDataUrl(supabaseAdmin, reel.user_id, p.path);
      if (url) images.push({ url, t: p.t, index: p.index });
    }
    if (images.length === 0) {
      return { analysis: null, moments: [], sport: null, suggested_clip: null };
    }
    const duration = times.length ? Math.max(...times) : null;
    const stamps = images
      .map((im, i) => `frame ${i + 1}${im.t != null ? ` @ ${im.t}s` : ""}`)
      .join(", ");
    const parts: Array<Record<string, any>> = [
      {
        type: "text",
        text: `These frames are sampled across a sports highlight clip titled "${reel.title}"${
          reel.game_title ? ` from the game "${reel.game_title}"` : ""
        }${duration ? `, about ${Math.round(duration)}s long` : ""}. In order: ${stamps}. Describe what is happening and when.`,
      },
      ...images.map((im) => ({ type: "image_url", image_url: { url: im.url } })),
    ];
    const out = await callLovableAIParts(
      parts,
      [
        "You are a sports video analyst. Respond ONLY with JSON:",
        '{"sport":"basketball|football|soccer|baseball|softball|volleyball|tennis|pickleball|running|other",',
        '"summary":"2 sentences on what happens","moments":[{"label":"short play name","frame":1,"t":2.5,"note":"one line"}],',
        '"suggested_clip":{"start_pct":0,"end_pct":100,"why":"one line"},"quality_note":"one line on lighting/shake/framing"}',
        "Use the frame timestamps given in the prompt for `t` (seconds). Max 8 moments. Never invent scores or player names.",
      ].join(" "),
      ctx,
    );
    const frameTime = (frame: number) => {
      const im = images[Math.max(0, Math.min(images.length - 1, frame - 1))];
      return im?.t ?? null;
    };
    const moments = Array.isArray(out.moments)
      ? out.moments.slice(0, 8).map((m: any) => {
          const frame = Number(m?.frame) || 1;
          const t = Number.isFinite(Number(m?.t)) ? Number(m.t) : frameTime(frame);
          return {
            label: String(m?.label ?? "Highlight").slice(0, 60),
            frame,
            t: t != null ? Math.round(t * 100) / 100 : null,
            note: String(m?.note ?? "").slice(0, 160),
          };
        })
      : [];
    return {
      sport: out.sport ? String(out.sport).slice(0, 40) : null,
      moments,
      duration,
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

  /**
   * Spoken-word captions. The browser extracted a 16 kHz mono WAV at upload
   * time; silent or undecodable clips simply skip this step.
   */
  transcribe: async (reel, _p, ctx) => {
    const { supabaseAdmin } = ctx;
    if (!reel.audio_path) return { transcript: null };
    const b64 = await audioBase64(supabaseAdmin, reel.user_id, reel.audio_path);
    if (!b64) return { transcript: null };
    try {
      const out = await callLovableAIParts(
        [
          {
            type: "text",
            text: "Transcribe the speech in this sports clip audio. Ignore crowd noise and music.",
          },
          { type: "input_audio", input_audio: { data: b64, format: "wav" } },
        ],
        [
          "You transcribe short sports clips. Respond ONLY with JSON:",
          '{"text":"full transcript or empty string","segments":[{"t":1.2,"text":"..."}]}',
          "`t` is seconds from the clip start. Max 40 segments. If there is no intelligible speech, return an empty text and an empty segments array.",
        ].join(" "),
        ctx,
      );
      const segments = Array.isArray(out.segments)
        ? out.segments
            .slice(0, 40)
            .map((s: any) => ({
              t: Math.max(0, Number(s?.t) || 0),
              text: String(s?.text ?? "").slice(0, 200),
            }))
            .filter((s: { text: string }) => s.text.length > 0)
        : [];
      const text = String(out.text ?? "").slice(0, 4000);
      if (!text && segments.length === 0) return { transcript: null };
      return { transcript: { text, segments } };
    } catch {
      // Transcription is a bonus — never fail the whole reel over it.
      return { transcript: null };
    }
  },

  /** Play-by-play: timestamped moments the athlete can jump to. */
  timeline: async (reel, progress, ctx) => {
    const moments = (progress.moments ?? []) as any[];
    if (!progress.analysis?.summary && moments.length === 0) return { timeline: [] };
    const out = await callLovableAI(
      [
        `Clip: "${reel.title}"${reel.game_title ? ` (game: ${reel.game_title})` : ""}.`,
        progress.duration ? `Duration: ${Math.round(progress.duration)}s.` : "",
        `Sport: ${progress.sport ?? "unknown"}.`,
        progress.analysis?.summary ? `What the footage shows: ${progress.analysis.summary}` : "",
        moments.length
          ? `Detected moments: ${moments
              .map(
                (m) =>
                  `${m.t != null ? `${m.t}s` : `frame ${m.frame}`} — ${m.label}${m.note ? ` (${m.note})` : ""}`,
              )
              .join("; ")}`
          : "",
        progress.transcript?.text ? `Spoken audio: ${progress.transcript.text.slice(0, 800)}` : "",
        "Write the play-by-play for this clip.",
      ]
        .filter(Boolean)
        .join("\n"),
      [
        "You are a sports play-by-play writer. Respond ONLY with JSON:",
        '{"timeline":[{"t":1.5,"label":"short call (max 40 chars)","note":"one short line"}]}',
        "3 to 8 entries, ordered by time, `t` in seconds inside the clip. Only describe what the analysis and audio support — never invent scores, counts, or names.",
      ].join(" "),
      ctx,
    );
    const timeline = Array.isArray(out.timeline)
      ? out.timeline
          .slice(0, 8)
          .map((e: any) => ({
            t: Math.max(0, Math.round((Number(e?.t) || 0) * 100) / 100),
            label: String(e?.label ?? "").slice(0, 60),
            note: String(e?.note ?? "").slice(0, 160),
          }))
          .filter((e: { label: string }) => e.label.length > 0)
          .sort((a: { t: number }, b: { t: number }) => a.t - b.t)
      : [];
    return { timeline };
  },

  /** Cut list: which segments to keep, in what order, at what pace. */
  editplan: async (_reel, progress, ctx) => {
    const duration = Number(progress.duration) || 0;
    const timeline = (progress.timeline ?? []) as any[];
    if (!duration && timeline.length === 0) return { edit_plan: null };
    const out = await callLovableAI(
      [
        duration ? `Clip duration: ${Math.round(duration * 10) / 10}s.` : "Clip duration unknown.",
        `Sport: ${progress.sport ?? "unknown"}.`,
        timeline.length
          ? `Play-by-play: ${timeline.map((e) => `${e.t}s ${e.label}`).join("; ")}`
          : "",
        progress.analysis?.summary ? `Footage: ${progress.analysis.summary}` : "",
        `Requested style: ${reelStyleDirectives(_reel.style_prefs).summary}.`,
        "Build the edit for a short social highlight.",
      ]
        .filter(Boolean)
        .join("\n"),
      [
        "You are a highlight editor. Respond ONLY with JSON:",
        '{"segments":[{"start":1.2,"end":4.0,"pace":"normal|slowmo|hold|quick","why":"one short line"}],"why":"one line on the overall cut"}',
        "2 to 5 segments in playback order, each 0.8s or longer, all times inside the clip duration, no overlaps. Keep the total under 25 seconds.",
        reelStyleDirectives(_reel.style_prefs).edit,
      ].join(" "),
      ctx,
    );
    const cap = duration || 600;
    const PACES = ["normal", "slowmo", "hold", "quick"];
    const segments = Array.isArray(out.segments)
      ? out.segments
          .slice(0, 5)
          .map((s: any) => {
            const start = Math.max(0, Math.min(cap, Number(s?.start) || 0));
            const rawEnd = Number(s?.end) || start + 2;
            const end = Math.max(start + 0.5, Math.min(cap, rawEnd));
            const pace = PACES.includes(String(s?.pace)) ? String(s.pace) : "normal";
            return {
              start: Math.round(start * 100) / 100,
              end: Math.round(end * 100) / 100,
              pace,
              why: String(s?.why ?? "").slice(0, 160),
            };
          })
          .sort((a: { start: number }, b: { start: number }) => a.start - b.start)
      : [];
    if (segments.length === 0) return { edit_plan: null };
    return {
      edit_plan: {
        segments,
        why: String(out.why ?? "").slice(0, 240),
        total:
          Math.round(segments.reduce((n: number, s: any) => n + (s.end - s.start), 0) * 10) / 10,
      },
    };
  },

  /** Sport-aware coaching report: what looked good, what to fix, drills. */
  coach: async (_reel, progress, ctx) => {
    if (!progress.analysis?.summary) return { coaching: null };
    const out = await callLovableAI(
      [
        `Sport: ${progress.sport ?? "unknown"}.`,
        `Footage: ${progress.analysis.summary}`,
        progress.analysis.quality_note ? `Footage quality: ${progress.analysis.quality_note}` : "",
        (progress.timeline ?? []).length
          ? `Play-by-play: ${(progress.timeline ?? []).map((e: any) => `${e.t}s ${e.label}`).join("; ")}`
          : "",
        "Coach this athlete on what you can actually see.",
      ]
        .filter(Boolean)
        .join("\n"),
      [
        "You are an amateur-level sports coach. Respond ONLY with JSON:",
        '{"strengths":["..."],"notes":["..."],"drills":["..."],"confidence":"one line on how much the footage supports this"}',
        "2 to 3 items per list, each under 140 characters, technique-specific to the sport. If the footage is too short, blurry, or far away to judge technique, say so in `confidence` and keep the notes general instead of inventing detail.",
      ].join(" "),
      ctx,
    );
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v
            .map((x) => String(x).slice(0, 200).trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];
    const coaching = {
      strengths: list(out.strengths),
      notes: list(out.notes),
      drills: list(out.drills),
      confidence: String(out.confidence ?? "").slice(0, 240),
    };
    if (!coaching.strengths.length && !coaching.notes.length && !coaching.drills.length) {
      return { coaching: null };
    }
    return { coaching };
  },

  metadata: async (reel, progress, ctx) => {
    const context = progress.analysis?.summary
      ? `What the footage shows: ${progress.analysis.summary}. Detected sport: ${progress.sport ?? "unknown"}. Key moments: ${(
          progress.moments ?? []
        )
          .map((m: any) => m.label)
          .join(", ")}.`
      : "";
    const out = await callLovableAI(
      `Original filename/title: "${reel.title}". ${context} Generate an engaging title and caption for this sports highlight clip.`,
      `Respond ONLY with JSON: {"title":"...","caption":"..."}. Title max 60 chars, caption max 200 chars. ${
        reelStyleDirectives(reel.style_prefs).copy
      }`,
      ctx,
    );
    return {
      ai_title: String(out.title ?? "").slice(0, 120),
      ai_caption: String(out.caption ?? "").slice(0, 500),
    };
  },
  hashtags: async (reel, progress, ctx) => {
    const out = await callLovableAI(
      `Title: "${progress.ai_title}". Caption: "${progress.ai_caption}". Sport: ${
        progress.sport ?? "unknown"
      }. Generate 3-5 trending hashtags.`,
      `Respond ONLY with JSON: {"hashtags":["..."]}. Max 8 hashtags, no leading #. ${
        reelStyleDirectives(reel.style_prefs).vibe
      }`,
      ctx,
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
    const times = reel.frame_times ?? [];
    // Prefer the frame closest to the first play-by-play beat, then the first
    // detected moment's frame, then the opening frame.
    const targetT = (progress.timeline ?? [])[0]?.t ?? (progress.moments ?? [])[0]?.t ?? null;
    if (targetT != null && times.length) {
      let bestIdx = 0;
      let bestGap = Infinity;
      times.forEach((t, i) => {
        const gap = Math.abs(Number(t) - Number(targetT));
        if (gap < bestGap && frames[i]) {
          bestGap = gap;
          bestIdx = i;
        }
      });
      return { thumbnail_path: frames[bestIdx] ?? frames[0] };
    }
    const best = (progress.moments ?? [])[0]?.frame;
    const idx = best && best >= 1 && best <= frames.length ? best - 1 : 0;
    return { thumbnail_path: frames[idx] ?? frames[0] };
  },
  finalize: async () => ({ finalized_at: new Date().toISOString() }),
};

/**
 * Style regeneration: keep everything the captured media produced (visual
 * analysis, detected sport/moments, transcript) and drop every style-dependent
 * artifact so the pipeline rewrites them with the new style. Resuming after
 * "transcribe" re-runs timeline → editplan → coach → metadata → hashtags →
 * thumbnail without re-reading the video, frames, or audio.
 */
export const CAPTURED_MEDIA_KEYS = [
  "sport",
  "moments",
  "duration",
  "analysis",
  "suggested_clip",
  "transcript",
] as const;

export function prepareStyleRegen(progress: Record<string, any> | null) {
  const kept: Record<string, any> = {};
  for (const key of CAPTURED_MEDIA_KEYS) {
    if (progress?.[key] != null) kept[key] = progress[key];
  }
  return { step_progress: kept, processing_step: "transcribe" };
}

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

/**
 * Screens the reel's AI copy and sampled frames before it may become visible.
 * Blocked copy is dropped, borderline copy and any unsafe or unverifiable
 * footage keep the reel owner-only (`hidden_at`), and suspected child sexual
 * abuse material quarantines the reel outright. Fails closed throughout; the
 * original upload is never deleted.
 */
async function screenReelOutput(
  reel: Reel,
  progress: Record<string, any>,
  ctx: StepCtx,
): Promise<{ quarantined: boolean; hiddenAt: string | null; note: string | null }> {
  const { supabaseAdmin, session } = ctx;
  const jobId = session?.jobId ?? null;
  const { moderateAiFields, checkReelFrameSafety, quarantineForChildSafety } = await import(
    "@/lib/ai/moderation.server"
  );

  const hashtags: string[] = Array.isArray(progress.ai_hashtags) ? progress.ai_hashtags : [];
  const coaching = progress.coaching ?? null;
  const moderated = await moderateAiFields(supabaseAdmin, {
    userId: reel.user_id,
    jobId,
    table: "highlight_reels",
    id: reel.id,
    context: "AI-written highlight reel copy shown publicly",
    fields: {
      ai_title: String(progress.ai_title ?? ""),
      ai_caption: String(progress.ai_caption ?? ""),
      ai_hashtags: hashtags.join(" "),
      ai_coaching: coaching
        ? [...(coaching.strengths ?? []), ...(coaching.notes ?? []), ...(coaching.drills ?? [])].join(
            " ",
          )
        : "",
    },
  });

  if (moderated.blocked.includes("ai_title")) progress.ai_title = "";
  if (moderated.blocked.includes("ai_caption")) progress.ai_caption = "";
  if (moderated.blocked.includes("ai_hashtags")) progress.ai_hashtags = [];
  if (moderated.blocked.includes("ai_coaching")) progress.coaching = null;

  // Frame safety on the frames already sampled at upload time.
  const framePaths = (reel.frame_paths ?? []).slice(0, 3);
  const frames: string[] = [];
  for (const path of framePaths) {
    const url = await frameDataUrl(supabaseAdmin, reel.user_id, path);
    if (url) frames.push(url);
  }
  const safety = await checkReelFrameSafety(supabaseAdmin, {
    userId: reel.user_id,
    reelId: reel.id,
    frames,
    jobId,
  });

  if (safety.csam) {
    await quarantineForChildSafety(supabaseAdmin, {
      userId: reel.user_id,
      reelId: reel.id,
      path: reel.video_path,
      categories: safety.categories,
      source: "reel_pipeline_frame_scan",
    });
    return { quarantined: true, hiddenAt: new Date().toISOString(), note: null };
  }

  const holdBack =
    !safety.safe ||
    safety.unavailable ||
    moderated.review.length > 0 ||
    moderated.blocked.length > 0 ||
    moderated.unavailable;

  return {
    quarantined: false,
    hiddenAt: holdBack ? new Date().toISOString() : null,
    note: holdBack
      ? "Your reel is saved and visible to you only while our safety check finishes reviewing it."
      : null,
  };
}

/**
 * Claims a reel for one processing run.
 *
 * The attempt bump is conditional on the attempt count we read, so two
 * overlapping requests for the same reel (upload trigger + resume/worker
 * sweep) can never both run the pipeline and double-charge the AI budget.
 * Returns false when another run already claimed it.
 */
export async function claimReel(supabaseAdmin: any, reel: Reel) {
  const progress: Record<string, any> = { ...(reel.step_progress ?? {}) };
  const startStep = firstStep(reel.processing_step);
  const startIdx = STEPS.indexOf(startStep);
  progress._pipeline = snapshot(STEPS.slice(0, startIdx), startStep, reel.attempts + 1);

  const { data } = await supabaseAdmin
    .from("highlight_reels")
    .update({
      attempts: reel.attempts + 1,
      processing_started_at: new Date().toISOString(),
      step_progress: progress,
      last_step_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", reel.id)
    .eq("attempts", reel.attempts)
    .select("id");

  return (data?.length ?? 0) > 0;
}

export async function processReel(
  reel: Reel,
  supabaseAdmin: any,
  apiKey: string,
  session?: AiSession | null,
  alreadyClaimed = false,
) {
  const progress: Record<string, any> = { ...(reel.step_progress ?? {}) };
  const startStep = firstStep(reel.processing_step);
  const startIdx = STEPS.indexOf(startStep);
  const resumed = reel.processing_step !== "pending" && startIdx > 0;
  const attempt = reel.attempts + 1;
  const done: Step[] = STEPS.slice(0, startIdx);

  progress._pipeline = snapshot(done, startStep, attempt);

  if (!alreadyClaimed && !(await claimReel(supabaseAdmin, reel))) {
    return { id: reel.id, status: "skipped" };
  }


  try {
    for (let i = startIdx; i < STEPS.length; i++) {
      const step = STEPS[i];
      // Announce the step *before* running it so the card shows what's happening now.
      progress._pipeline = snapshot(done, step, attempt);
      await supabaseAdmin
        .from("highlight_reels")
        .update({ step_progress: progress, last_step_at: new Date().toISOString() })
        .eq("id", reel.id);

      const patch = await STEP_RUNNERS[step](reel, progress, { supabaseAdmin, apiKey, session });
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

    // Safety screening runs before the reel can become visible to anyone else.
    const screening = await screenReelOutput(reel, progress, { supabaseAdmin, apiKey, session });
    if (screening.quarantined) {
      await supabaseAdmin.from("notifications").insert({
        user_id: reel.user_id,
        type: "reel_blocked",
        title: "Reel held for review",
        body: "Your reel didn't pass our safety check and is being reviewed.",
        link: "/reels",
      });
      return { id: reel.id, status: "blocked" };
    }

    await supabaseAdmin
      .from("highlight_reels")
      .update({
        status: "completed",
        hidden_at: screening.hiddenAt,
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
        ai_timeline: progress.timeline ?? [],
        ai_edit_plan: progress.edit_plan ?? null,
        ai_coaching: progress.coaching ?? null,
        ai_transcript: progress.transcript ?? null,
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
      body: screening.note ?? (progress.ai_title ? String(progress.ai_title) : reel.title),
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

/**
 * Non-destructive restyle: runs the style-dependent steps in memory using the
 * media analysis already captured for this reel and returns the result WITHOUT
 * touching the stored row. Powers the side-by-side compare mode, so the athlete
 * can preview a restyled version before publishing over the current one.
 */
export const STYLE_DRAFT_STEPS: Step[] = [
  "timeline",
  "editplan",
  "coach",
  "metadata",
  "hashtags",
  "thumbnail",
];

export type ReelStyleDraft = {
  style: Record<string, any>;
  ai_title: string | null;
  ai_caption: string | null;
  ai_hashtags: string[];
  timeline: { t: number; label: string; note?: string }[];
  edit_plan: { segments: any[]; why?: string; total?: number } | null;
  coaching: Record<string, any> | null;
  thumbnail_path: string | null;
  overlays: { at: string; text: string }[];
  created_at: string;
};

export async function runStyleDraft(
  reel: Reel,
  style: Record<string, any>,
  supabaseAdmin: any,
  apiKey: string,
  session?: AiSession | null,
): Promise<ReelStyleDraft> {
  const progress: Record<string, any> = { ...prepareStyleRegen(reel.step_progress).step_progress };
  const styledReel: Reel = { ...reel, style_prefs: style };

  for (const step of STYLE_DRAFT_STEPS) {
    const patch = await STEP_RUNNERS[step](styledReel, progress, { supabaseAdmin, apiKey, session });
    Object.assign(progress, patch);
  }

  // Fresh on-screen text in the new style, timed to the drafted timeline.
  let overlays: { at: string; text: string }[] = [];
  try {
    const { generateReelPackage } = await import("@/lib/reel-coach.server");
    const pkg = await generateReelPackage(apiKey, {
      id: reel.id,
      title: reel.title,
      game_title: reel.game_title ?? null,
      status: "completed",
      style_prefs: style,
      ai_title: progress.ai_title ?? null,
      ai_caption: progress.ai_caption ?? null,
      ai_hashtags: progress.ai_hashtags ?? [],
      ai_sport: progress.sport ?? null,
      ai_analysis: progress.analysis ?? null,
      ai_moments: progress.moments ?? [],
      ai_timeline: progress.timeline ?? [],
      ai_edit_plan: progress.edit_plan ?? null,
      ai_coaching: progress.coaching ?? null,
      ai_transcript: progress.transcript ?? null,
      suggested_clip: progress.suggested_clip ?? null,
    });
    overlays = pkg.overlays ?? [];
  } catch {
    // Overlays are a bonus — the drafted style still previews fine.
  }

  return {
    style,
    ai_title: progress.ai_title ?? null,
    ai_caption: progress.ai_caption ?? null,
    ai_hashtags: progress.ai_hashtags ?? [],
    timeline: progress.timeline ?? [],
    edit_plan: progress.edit_plan ?? null,
    coaching: progress.coaching ?? null,
    thumbnail_path: progress.thumbnail_path ?? null,
    overlays,
    created_at: new Date().toISOString(),
  };
}
