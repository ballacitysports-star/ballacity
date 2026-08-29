/**
 * Highlight-reel (recap) helpers shared by the profile Archive and the reels page.
 *
 * A recap is a row in `highlight_reels`. Rows carry a pipeline `status`
 * (processing / completed / failed) plus a `processing_step` so the UI can show
 * meaningful progress instead of a spinner.
 */

export type RecapSummary = {
  id: string;
  title: string;
  video_path: string;
  status: string;
  processing_step: string | null;
  /** Live snapshot written by the server pipeline (see `_pipeline`). */
  step_progress?: Record<string, any> | null;
  thumbnail_path: string | null;
  ai_title: string | null;
  ai_caption: string | null;
  ai_hashtags: string[] | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  game_id: string | null;
  game_title: string | null;
};

/** Columns needed for status + inline playback. */
export const RECAP_COLUMNS =
  "id,title,video_path,status,processing_step,step_progress,thumbnail_path,ai_title,ai_caption,ai_hashtags,error_message,created_at,completed_at,game_id,game_title";

const STEP_ORDER = [
  "pending",
  "analyze",
  "metadata",
  "hashtags",
  "thumbnail",
  "finalize",
  "completed",
];

/** Pipeline steps in run order (mirrors `STEPS` in reels-pipeline.server.ts). */
export const RECAP_STEPS = ["analyze", "metadata", "hashtags", "thumbnail", "finalize"] as const;
export type RecapStep = (typeof RECAP_STEPS)[number];

const STEP_LABELS: Record<string, string> = {
  pending: "Queued",
  analyze: "Watching your clip",
  metadata: "Writing title & caption",
  hashtags: "Picking hashtags",
  thumbnail: "Building thumbnail",
  finalize: "Finishing up",
  completed: "Ready",
};

type ProgressInput = Pick<RecapSummary, "status" | "processing_step"> & {
  step_progress?: Record<string, any> | null;
};

type Snapshot = {
  active: string | null;
  done: string[];
  failed: string | null;
  percent: number;
  attempt: number;
};

/** Reads the server-written live snapshot, when present. */
function snapshotOf(recap: ProgressInput): Snapshot | null {
  const raw = recap.step_progress?.["_pipeline"];
  if (!raw || typeof raw !== "object") return null;
  const done = Array.isArray(raw.done) ? raw.done.map(String) : [];
  const percent = Number(raw.percent);
  return {
    active: raw.active ? String(raw.active) : null,
    done,
    failed: raw.failed ? String(raw.failed) : null,
    percent: Number.isFinite(percent) ? percent : 0,
    attempt: Number(raw.attempt) || 1,
  };
}

/** Human label for the current pipeline position. */
export function recapStepLabel(recap: ProgressInput): string {
  if (recap.status === "completed") return "Ready to watch";
  if (recap.status === "failed") return "Generation failed";
  const snap = snapshotOf(recap);
  if (snap?.active) return STEP_LABELS[snap.active] ?? "Processing";
  return STEP_LABELS[String(recap.processing_step ?? "pending")] ?? "Processing";
}

/** Completion percentage (0-100) for the progress bar. */
export function recapProgress(recap: ProgressInput): number {
  if (recap.status === "completed") return 100;
  const snap = snapshotOf(recap);
  if (snap && snap.percent > 0) return Math.min(100, snap.percent);
  if (recap.status === "failed") return 100;
  const idx = STEP_ORDER.indexOf(String(recap.processing_step ?? "pending"));
  const safe = idx < 0 ? 0 : idx;
  return Math.max(8, Math.round((safe / (STEP_ORDER.length - 1)) * 100));
}

export type RecapStepState = {
  step: RecapStep;
  label: string;
  state: "done" | "active" | "failed" | "pending";
};

/**
 * Per-step status for the progress checklist. Falls back to `processing_step`
 * for rows processed before live snapshots existed.
 */
export function recapStepStates(recap: ProgressInput): RecapStepState[] {
  const snap = snapshotOf(recap);
  const fallbackIdx = RECAP_STEPS.indexOf(String(recap.processing_step) as RecapStep);
  return RECAP_STEPS.map((step, i) => {
    let state: RecapStepState["state"];
    if (recap.status === "completed") state = "done";
    else if (snap) {
      if (snap.done.includes(step)) state = "done";
      else if (snap.failed === step) state = "failed";
      else if (snap.active === step) state = recap.status === "failed" ? "pending" : "active";
      else state = "pending";
    } else if (i <= fallbackIdx) state = "done";
    else if (i === fallbackIdx + 1 && recap.status === "processing") state = "active";
    else state = "pending";
    return { step, label: STEP_LABELS[step] ?? step, state };
  });
}

/** Retry count reported by the pipeline, when known. */
export function recapAttempt(recap: ProgressInput): number | null {
  return snapshotOf(recap)?.attempt ?? null;
}


export function isRecapReady(recap: Pick<RecapSummary, "status">) {
  return recap.status === "completed";
}

/** Newest-first, with ready recaps preferred so the Archive always opens the latest playable one. */
export function pickLatestRecap(recaps: RecapSummary[]): RecapSummary | null {
  if (recaps.length === 0) return null;
  const byNewest = [...recaps].sort(
    (a, b) =>
      new Date(b.completed_at ?? b.created_at).getTime() -
      new Date(a.completed_at ?? a.created_at).getTime(),
  );
  return byNewest.find(isRecapReady) ?? byNewest[0];
}

export function recapDisplayTitle(recap: RecapSummary) {
  return recap.ai_title || recap.title;
}

/** Text + link used when sharing a finished-game recap. */
export function buildRecapShare(
  recap: RecapSummary | null,
  game: { id: string; title: string },
  origin: string,
) {
  const url = `${origin}/games/${game.id}`;
  const hashtags = (recap?.ai_hashtags ?? []).slice(0, 3).map((h) => `#${h.replace(/^#/, "")}`);
  const text = [
    recap ? recapDisplayTitle(recap) : `Highlights from ${game.title}`,
    recap?.ai_caption ?? "",
    hashtags.join(" "),
  ]
    .filter(Boolean)
    .join("\n");
  return { url, text, title: recap ? recapDisplayTitle(recap) : game.title };
}

/** Shares via the native sheet when available, otherwise copies to the clipboard. */
export async function shareRecap(
  recap: RecapSummary | null,
  game: { id: string; title: string },
): Promise<"shared" | "copied" | "failed"> {
  if (typeof window === "undefined") return "failed";
  const { url, text, title } = buildRecapShare(recap, game, window.location.origin);
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return "copied";
  } catch (e: any) {
    if (e?.name === "AbortError") return "shared";
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return "copied";
    } catch {
      return "failed";
    }
  }
}
