/**
 * WP 4.0: the sentences our own image upload code refuses with (the checks in image-validation.ts, uploadDataUrlToBucket
 * in image-upload.ts, finalizeImageUpload in image-uploads.functions.ts). They tell the member what is wrong with the
 * file, so every upload screen shows them as they are; anything else, such as a storage error, goes through
 * userErrorMessage and never shows raw.
 */
import { userErrorMessage, errorText } from "@/lib/user-error";

/** uploadDataUrlToBucket, and the game cover upload, when the safety scan holds the picture. */
export const IMAGE_FLAGGED_MESSAGE =
  "This image was flagged by our automated safety check and is pending review.";
/** finalizeImageUpload: an animated PNG or WEBP. */
export const ANIMATED_IMAGE_REFUSAL =
  "Animated pictures can't be uploaded. Use a still photo instead.";
/** finalizeImageUpload: stored bytes with no readable image header. */
export const UNREADABLE_IMAGE_REFUSAL = "The file is not a readable JPG, PNG or WEBP image";

/** validateImageMeta's sentences (type, empty, size, dimensions, resolution) and the ones above. */
const IMAGE_UPLOAD_OWN_TEXT =
  /^(?:Only JPG, PNG or WEBP images are allowed|The file is empty|Image is too (?:large|small) \([^)]{1,40}\)|Image resolution is too high)$/;

const OWN_SENTENCES: ReadonlySet<string> = new Set([
  IMAGE_FLAGGED_MESSAGE,
  ANIMATED_IMAGE_REFUSAL,
  UNREADABLE_IMAGE_REFUSAL,
]);

/** Whether `text` is one of our own image upload refusals. */
export function isImageUploadRefusal(text: string | null | undefined): boolean {
  return !!text && (OWN_SENTENCES.has(text) || IMAGE_UPLOAD_OWN_TEXT.test(text));
}

/** What an upload screen shows when an image upload fails: our own refusal as it is, else userErrorMessage's. */
export function imageUploadErrorMessage(err: unknown, fallback: string): string {
  const text = errorText(err);
  return text && isImageUploadRefusal(text) ? text : userErrorMessage(err, fallback);
}
