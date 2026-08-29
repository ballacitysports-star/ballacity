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
  "id,title,video_path,status,processing_step,thumbnail_path,ai_title,ai_caption,ai_hashtags,error_message,created_at,completed_at,game_id,game_title";

const STEP_ORDER = [
  "pending",
  "analyze",
  "metadata",
  "hashtags",
  "thumbnail",
  "finalize",
  "completed",
];

const STEP_LABELS: Record<string, string> = {
  pending: "Queued",
  analyze: "Watching your clip",
  metadata: "Writing title & caption",
  hashtags: "Picking hashtags",
  thumbnail: "Building thumbnail",
  finalize: "Finishing up",
  completed: "Ready",
};

/** Human label for the current pipeline position. */
export function recapStepLabel(recap: Pick<RecapSummary, "status" | "processing_step">): string {
  if (recap.status === "completed") return "Ready to watch";
  if (recap.status === "failed") return "Generation failed";
  return STEP_LABELS[String(recap.processing_step ?? "pending")] ?? "Processing";
}

/** Rough completion percentage (0-100) for the progress bar. */
export function recapProgress(recap: Pick<RecapSummary, "status" | "processing_step">): number {
  if (recap.status === "completed") return 100;
  if (recap.status === "failed") return 100;
  const idx = STEP_ORDER.indexOf(String(recap.processing_step ?? "pending"));
  const safe = idx < 0 ? 0 : idx;
  return Math.max(8, Math.round((safe / (STEP_ORDER.length - 1)) * 100));
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
