/**
 * What the reels upload shows when posting a clip fails. Three kinds of failure reach it:
 *
 * - the page's own refusals (ReelUploadProblem: size, plan limits, resolution), worded for the member already;
 * - finalizeVideoUpload's server refusals, which re-check the same rules on the stored file and arrive as plain
 *   Errors: the fixed sentences in video-validation.ts and the plan-limit shapes in ai/upload-limits.ts. They say why
 *   the clip was refused, so they show as they are;
 * - anything else: a Storage error from the upload itself (a size refusal gets the size sentence, never the raw
 *   storage text), a PostgREST or network error, which go through familyPostErrorMessage / userErrorMessage.
 */
import { PLAN_LIMIT_REFUSALS } from "@/lib/ai/upload-limits";
import { familyPostErrorMessage } from "@/lib/family-posts";
import { errorText, userErrorMessage } from "@/lib/user-error";
import {
  VIDEO_EMPTY_MESSAGE,
  VIDEO_NOT_PLAYABLE_MESSAGE,
  VIDEO_TOO_LARGE_MESSAGE,
  VIDEO_UPLOAD_MISSING_MESSAGE,
} from "@/lib/video-validation";

/** An upload problem the reels page words itself, so its sentence shows as it is. */
export class ReelUploadProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelUploadProblem";
  }
}

export const REEL_UPLOAD_FALLBACK = "Upload failed. Please try again.";
export const REEL_CONVERTER_UNAVAILABLE_MESSAGE =
  "Video conversion is temporarily unavailable. Nothing was uploaded — please try again shortly.";
export const REEL_STORAGE_FAILED_MESSAGE =
  "Couldn't upload this clip. Check your connection and try again.";

const SERVER_SENTENCES: ReadonlySet<string> = new Set([
  VIDEO_TOO_LARGE_MESSAGE,
  VIDEO_EMPTY_MESSAGE,
  VIDEO_NOT_PLAYABLE_MESSAGE,
  VIDEO_UPLOAD_MISSING_MESSAGE,
]);

/** Whether `text` is one of finalizeVideoUpload's own refusals. */
export function isReelServerRefusal(text: string | null | undefined): boolean {
  return !!text && (SERVER_SENTENCES.has(text) || PLAN_LIMIT_REFUSALS.some((re) => re.test(text)));
}

function field(err: unknown, key: string): unknown {
  return err !== null && typeof err === "object"
    ? (err as Record<string, unknown>)[key]
    : undefined;
}

/** A supabase-js Storage error (StorageError, StorageApiError, StorageUnknownError), or one shaped like it. */
function isStorageError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  if ("__isStorageError" in err) return true;
  const name = field(err, "name");
  return (
    (typeof name === "string" && /^Storage\w*Error$/.test(name)) || field(err, "statusCode") != null
  );
}

/** A Storage refusal of the file's size: HTTP 413 or the bucket's size-limit wording. */
function isStorageSizeRefusal(err: unknown, text: string): boolean {
  const status = field(err, "status");
  const statusCode = field(err, "statusCode");
  return (
    status === 413 ||
    statusCode === 413 ||
    statusCode === "413" ||
    /maximum allowed size|payload too large|entity too large/i.test(text)
  );
}

export function reelUploadErrorMessage(err: unknown): string {
  if (err instanceof ReelUploadProblem) return err.message;
  if (field(err, "name") === "ConverterUnavailableError") return REEL_CONVERTER_UNAVAILABLE_MESSAGE;
  const text = errorText(err) ?? "";
  if (isReelServerRefusal(text)) return text;
  if (isStorageError(err)) {
    if (isStorageSizeRefusal(err, text)) return VIDEO_TOO_LARGE_MESSAGE;
    // Offline, an ended session or a refused write still read as such; never the storage text.
    return userErrorMessage(err, REEL_STORAGE_FAILED_MESSAGE);
  }
  return familyPostErrorMessage(err) ?? userErrorMessage(err, REEL_UPLOAD_FALLBACK);
}
