/**
 * The subset of the Cloudflare Images binding (`env.IMAGES`) that the image runtime PoC uses, typed to the real API.
 *
 * Copied from the official type definitions shipped with workerd 1.20260908.1 (`workerd/worker.mjs`: `ImagesBinding`,
 * `ImageTransformer`, `ImageTransform`, `ImageOutputOptions`, `ImageInfoResponse`, `ImagesError`), the same definitions
 * that `@cloudflare/workers-types` publishes. Only the members the PoC calls are kept; `text()`, `hosted` and the draw options
 * are left out on purpose (the re-encoder never renders text, stores images in Cloudflare or composites).
 *
 * Documentation: https://developers.cloudflare.com/images/optimization/binding/ (formerly /images/transform-images/bindings/).
 * Note the documented `.output()` options are `format`, `quality` and `anim`; the type also lists `background` and the raw
 * `rgb`/`rgba` formats, which the prose documentation does not describe and Wrangler's local mode refuses
 * ("RGB/RGBA output is not supported in local mode"). See docs/privacy/image-runtime-evaluation.md.
 */

/** `.info()`: SVG reports its type only; bitmaps report type, byte size and size in pixels. No frame count, no orientation. */
export type ImageInfoResponse =
  { format: "image/svg+xml" } | { format: string; fileSize: number; width: number; height: number };

/** The transform parameters the PoC may send (a subset of the binding's `ImageTransform`). */
export type ImageTransform = {
  width?: number;
  height?: number;
  background?: string;
  fit?: "scale-down" | "contain" | "pad" | "squeeze" | "cover" | "crop";
  flip?: "h" | "v" | "hv";
  rotate?: 0 | 90 | 180 | 270;
};

export type ImageOutputOptions = {
  format: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" | "rgb" | "rgba";
  quality?: number;
  background?: string;
  anim?: boolean;
};

export type ImageInputOptions = { encoding?: "base64" };

export interface ImageTransformationResult {
  response(options?: { headers?: HeadersInit }): Response;
  contentType(): string;
  image(options?: { encoding?: "base64" }): ReadableStream<Uint8Array>;
}

export interface ImageTransformer {
  transform(transform: ImageTransform): ImageTransformer;
  output(options: ImageOutputOptions): Promise<ImageTransformationResult>;
}

export interface ImagesBinding {
  info(stream: ReadableStream<Uint8Array>, options?: ImageInputOptions): Promise<ImageInfoResponse>;
  input(stream: ReadableStream<Uint8Array>, options?: ImageInputOptions): ImageTransformer;
}

/** Errors thrown by the binding carry a numeric code (https://developers.cloudflare.com/images/reference/troubleshooting/). */
export interface ImagesError extends Error {
  readonly code: number;
}

export function imagesErrorCode(e: unknown): number | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  // Local mode and some remote paths put the code in the message only ("ERROR 9520: ...", "IMAGES_TRANSFORM_ERROR 9520").
  const m = /\b(9\d{3})\b/.exec(String((e as Error | null)?.message ?? ""));
  return m ? Number(m[1]) : null;
}
