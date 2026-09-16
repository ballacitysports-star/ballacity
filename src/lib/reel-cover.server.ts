/**
 * AI cover art for a reel (server-only) — the first consumer of the Phase 4
 * image features.
 *
 * Two modes, and which one runs is not a cosmetic choice:
 *
 * - When the reel has a sampled frame, the cover is an EDIT of that frame
 *   (`image_enhance`). The athlete's own footage anchors the output.
 * - Only when no frame exists does it fall back to text-to-image
 *   (`image_generate`), which is adult-only by cohort policy.
 *
 * `coverFeatureFor` decides that up front so the caller opens the gate with the
 * right feature key and minors are never silently routed into free-form
 * generation.
 *
 * Every produced image is screened before it is stored, and screening fails
 * closed: an image that cannot be checked is discarded, not saved.
 */

import type { AiFeature } from "@/lib/ai/config";
import { runAiCall, type AiSession } from "@/lib/ai/gate.server";
import { assertOwnedMediaPath } from "@/lib/media-path-guard";
import { reelStyleDirectives } from "@/lib/reel-style";
import { frameDataUrl } from "@/lib/reels-pipeline.server";

export const COVER_COLUMNS =
  "id,user_id,title,ai_title,ai_sport,ai_analysis,ai_moments,thumbnail_path,frame_paths,frame_times,game_title,style_prefs";

const BUCKET = "highlight-videos";
/** Guard against a model returning something far larger than a cover needs. */
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export type ReelCover = {
  /** Storage path of the saved cover, always `<user_id>/...`. */
  path: string;
  /** The saved image, so the UI can show it without a second round trip. */
  dataUrl: string;
  /** Which Phase 4 feature produced it. */
  feature: AiFeature;
};

/**
 * `image_enhance` when there is a frame to edit, `image_generate` otherwise.
 * Callers must open the AI gate with exactly this key.
 */
export function coverFeatureFor(reel: Record<string, any>): AiFeature {
  return pickSourceFrame(reel) ? "image_enhance" : "image_generate";
}

/** Prefers the pipeline's chosen thumbnail, else the middle sampled frame. */
export function pickSourceFrame(reel: Record<string, any>): string | null {
  const thumb = typeof reel?.thumbnail_path === "string" ? reel.thumbnail_path : "";
  if (thumb) return thumb;
  const frames = Array.isArray(reel?.frame_paths)
    ? reel.frame_paths.filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
    : [];
  if (frames.length === 0) return null;
  return frames[Math.floor(frames.length / 2)];
}

/** What the cover should depict, drawn only from what the pipeline observed. */
function subjectOf(reel: Record<string, any>): string {
  const sport = typeof reel?.ai_sport === "string" ? reel.ai_sport : "";
  const summary =
    typeof reel?.ai_analysis?.summary === "string" ? reel.ai_analysis.summary.slice(0, 200) : "";
  const moment = Array.isArray(reel?.ai_moments)
    ? String(reel.ai_moments[0]?.label ?? "").slice(0, 60)
    : "";
  return [
    sport ? `${sport} action` : "sports action",
    moment ? `featuring: ${moment}` : "",
    summary ? `scene: ${summary}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function editPrompt(reel: Record<string, any>, style: string, note?: string): string {
  return [
    "Turn this frame from a sports highlight into a bold cover image for the clip.",
    "Keep the real people, their poses, the venue and the action exactly as they are — this is a restyle, not a new scene.",
    "Do not add, remove or change any person. Do not alter anyone's face, body or apparent age.",
    "Improve contrast, colour and lighting so it reads as a thumbnail at small size.",
    "Add no text, no logos, no watermarks, no scoreboards and no numbers.",
    style ? `Visual style: ${style}` : "",
    note ? `Athlete's request: ${note}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function generatePrompt(reel: Record<string, any>, style: string, note?: string): string {
  return [
    `Create a bold, graphic cover image for a pickup-sports highlight clip: ${subjectOf(reel)}.`,
    "Stylised and illustrative, not photorealistic. Do not depict any identifiable real person.",
    "Depict adults only.",
    "Add no text, no logos, no watermarks and no numbers.",
    style ? `Visual style: ${style}` : "",
    note ? `Athlete's request: ${note}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Splits a `data:<mime>;base64,<payload>` URL into its parts. */
function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, contentType: match[1] };
  } catch {
    return null;
  }
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Produces a cover for one reel and saves it as the reel's thumbnail.
 *
 * `reel` must already be scoped to the caller. `session.feature` is expected to
 * match `coverFeatureFor(reel)`; it is asserted rather than trusted so a
 * mismatched gate call fails loudly instead of running the wrong policy.
 */
export async function generateReelCover(
  reel: Record<string, any>,
  opts: { session: AiSession; note?: string },
): Promise<ReelCover> {
  const { session } = opts;
  const userId = String(reel.user_id ?? "");
  if (!userId) throw new Error("Reel is missing an owner");

  const feature = coverFeatureFor(reel);
  if (session.feature !== feature) {
    throw new Error("Cover generation was gated on the wrong AI feature");
  }

  const style = reelStyleDirectives(reel.style_prefs).vibe;
  const framePath = pickSourceFrame(reel);

  let produced: {
    dataUrl: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
  };

  if (framePath) {
    // Read-side ownership check: the path came from a user-writable column and
    // is about to be read with the service role.
    assertOwnedMediaPath(userId, framePath);
    const sourceUrl = await frameDataUrl(session.admin, userId, framePath);
    if (!sourceUrl) throw new Error("That reel's frame could not be read — try again");
    produced = await runAiCall(session, (provider) =>
      provider.enhanceImage({
        imageUrl: sourceUrl,
        prompt: editPrompt(reel, style, opts.note),
      }),
    );
  } else {
    produced = await runAiCall(session, (provider) =>
      provider.generateImage({ prompt: generatePrompt(reel, style, opts.note) }),
    );
  }

  const decoded = decodeDataUrl(produced.dataUrl);
  if (!decoded) throw new Error("The generated cover was not a readable image");
  if (decoded.bytes.byteLength > MAX_COVER_BYTES) {
    throw new Error("The generated cover was too large to save");
  }

  // Screen the produced image exactly like uploaded footage. Fails closed:
  // unsafe or unverifiable means nothing is written.
  const { checkReelFrameSafety, quarantineForChildSafety, moderationBlocked } =
    await import("@/lib/ai/moderation.server");
  const verdict = await checkReelFrameSafety(session.admin, {
    userId,
    reelId: String(reel.id),
    frames: [produced.dataUrl],
    jobId: session.jobId,
  });
  if (verdict.csam) {
    await quarantineForChildSafety(session.admin, {
      userId,
      reelId: String(reel.id),
      categories: verdict.categories,
      source: "ai_cover_generation",
    });
    throw moderationBlocked();
  }
  if (!verdict.safe || verdict.unavailable) throw moderationBlocked();

  const path = `${userId}/covers/${reel.id}-${Date.now()}.${extensionFor(decoded.contentType)}`;
  const { error: uploadError } = await session.admin.storage
    .from(BUCKET)
    .upload(path, decoded.bytes, { contentType: decoded.contentType, upsert: true });
  if (uploadError) throw new Error(uploadError.message);

  const { error: updateError } = await session.admin
    .from("highlight_reels")
    .update({ thumbnail_path: path })
    .eq("id", reel.id)
    .eq("user_id", userId);
  if (updateError) {
    // The row is the source of truth; an orphaned object is preferable to a
    // reel pointing at a cover that was never recorded.
    throw new Error(updateError.message);
  }

  return { path, dataUrl: produced.dataUrl, feature };
}
