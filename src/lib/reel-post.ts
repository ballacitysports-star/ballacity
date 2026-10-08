/**
 * Review → Post for highlight reels.
 *
 * Pure module, shared by the Reels page and the server: where a reel is in its
 * life (processing, draft, posted, hidden), the post package the pipeline
 * drafts for the member to review, and the cleanup applied to whatever copy
 * they choose before it is saved and posted.
 *
 * `is_draft` is a separate flag from `hidden_at` on purpose: `hidden_at` also
 * carries safety holds and moderation, and posting must never be able to clear
 * one of those.
 */

export type PostOverlay = { at: string; text: string };

/** What the pipeline drafts for a reel; the member picks from it before posting. */
export type PostPackage = {
  captions: string[];
  hashtags: string[];
  overlays: PostOverlay[];
};

export type ReelPhase = "processing" | "failed" | "unavailable" | "draft" | "hidden" | "posted";

export function reelPhase(r: {
  status: string;
  is_draft?: boolean | null;
  hidden_at?: string | null;
}): ReelPhase {
  if (r.status === "failed") return "failed";
  if (r.status === "analysis_deleted") return "unavailable";
  if (r.status !== "completed") return "processing";
  if (r.is_draft) return "draft";
  if (r.hidden_at) return "hidden";
  return "posted";
}

function text(v: unknown, max: number): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "";
}

export function cleanHashtags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of v) {
    const tag = text(h, 40).replace(/^#+/, "").replace(/\s+/g, "");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === 8) break;
  }
  return out;
}

export function cleanOverlays(v: unknown): PostOverlay[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o: any) => ({ at: text(o?.at, 24), text: text(o?.text, 60) }))
    .filter((o) => o.text.length > 0)
    .slice(0, 6);
}

/** Reads `step_progress.package` defensively; null when there is nothing usable. */
export function normalizePostPackage(raw: unknown): PostPackage | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const rawCaptions = Array.isArray(src.captions) ? src.captions : src.caption ? [src.caption] : [];
  const captions = rawCaptions.map((c) => text(c, 500)).filter(Boolean).slice(0, 3);
  const hashtags = cleanHashtags(src.hashtags);
  const overlays = cleanOverlays(src.overlays);
  if (!captions.length && !hashtags.length && !overlays.length) return null;
  return { captions, hashtags, overlays };
}

/**
 * Caption choices to show on the review card: the drafted variants, with the
 * caption already on the reel kept as an option so nothing the member has is lost.
 */
export function captionChoices(pkg: PostPackage | null, current: string | null | undefined) {
  const out: string[] = [];
  const add = (c: string | null | undefined) => {
    const t = text(c, 500);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const c of pkg?.captions ?? []) add(c);
  add(current);
  return out.slice(0, 4);
}

/** The copy fields a post may set, cleaned. Absent or empty fields are left untouched. */
export function sanitizePostCopy(input: {
  title?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  overlays?: unknown;
}): {
  ai_title?: string;
  ai_caption?: string;
  ai_hashtags?: string[];
  ai_overlays?: PostOverlay[];
} {
  const patch: ReturnType<typeof sanitizePostCopy> = {};
  const title = text(input.title, 120);
  const caption = text(input.caption, 500);
  const hashtags = cleanHashtags(input.hashtags);
  const overlays = cleanOverlays(input.overlays);
  if (title) patch.ai_title = title;
  if (caption) patch.ai_caption = caption;
  if (hashtags.length) patch.ai_hashtags = hashtags;
  if (overlays.length) patch.ai_overlays = overlays;
  return patch;
}
