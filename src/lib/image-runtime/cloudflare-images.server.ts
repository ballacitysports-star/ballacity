/**
 * PROOF OF CONCEPT, NOT WIRED INTO THE APP. Canonical re-encoding (SEC-6 / M2) on the Cloudflare Images binding, with the same
 * contract as `reencodeImage` in src/lib/image-reencode.server.ts: same ReencodeResult, same ImageReencodeError codes, same rule
 * that the caller scans exactly the returned bytes and publishes exactly those bytes. Evaluation and residuals:
 * docs/privacy/image-runtime-evaluation.md. The binding is injected (`options.images`), typed to the real API
 * (src/lib/image-runtime/images-binding.ts); no Cloudflare account was used to build or test this.
 *
 * PIPELINE
 *   1. Sniff the type (JPEG, PNG or WEBP only) and run the byte stripper as a structural pre-check, exactly as the sharp path does.
 *      The stripper's output, not the upload, is what Cloudflare receives: EXIF (GPS, maker notes), XMP, IPTC and text chunks never
 *      leave the Worker. The orientation-only EXIF block the stripper writes is removed too, and the orientation is applied with
 *      explicit flip/rotate transforms, so the result does not depend on whether a given runtime (production, or Wrangler's local
 *      mode, which does not auto-orient) honours the tag.
 *   2. Refuse by the header's pixel count before calling the binding (decompression bombs), then `.info()` (free): Cloudflare must
 *      see the same type and the same stored size as the header.
 *   3. JPEG, and WEBP with no alpha ("direct path"): one binding call decodes, converts to sRGB, orients and re-encodes to the
 *      same type with fixed settings. JPEG has no alpha, so there is no colour under transparency to hide.
 *   4. PNG, and WEBP that can carry alpha ("pixel path"): the binding returns a PNG (decoded, sRGB, oriented); the Worker decodes
 *      it (src/lib/image-runtime/png-codec.ts), quantises the colour under transparent pixels with the SAME function the sharp path
 *      uses (quantiseHiddenColour), and writes a new PNG whose container is entirely its own (IHDR, IDAT, IEND). A PNG upload
 *      publishes that file; a WEBP upload is re-encoded from it by the binding. When any pixel is transparent, the scan renditions
 *      (contract v2: flattened on white and on black, plus alpha dropped when some alpha is partial) are made from the same
 *      quantised pixels. The pixel path holds one RGBA frame in the isolate (128 MB limit), so it
 *      is capped at PIXEL_PATH_MAX_PIXELS (too_large above it), lower than the 30 MP cap of the sharp path.
 *   5. Verify the output inside the Worker: same type and expected oriented size (header and `.info()`), nothing the byte inspector
 *      would strip, and an allow-list of container structure (JPEG: tables, frame, scans, optional plain JFIF APP0; PNG: IHDR, IDAT,
 *      IEND; WEBP: VP8X with no ICC/EXIF/XMP/animation flag, ALPH, VP8/VP8L). A lossy output identical to what was sent is refused
 *      (a pass-through, not a re-encode).
 *
 * FAIL CLOSED. Every binding error, timeout, unexpected content type, oversize output or failed check throws ImageReencodeError.
 * Platform-side problems (no binding, quota, outage, timeout) map to "unavailable", which promotion treats as held (nothing
 * published, retryable); problems with the file map to "unreadable"/"too_large"/"unsupported"/"animated". The input bytes are
 * never returned: the result is always bytes read from a binding output or written by the PNG encoder from decoded pixels.
 */
import { inspectImageMetadata, stripImageMetadata } from "@/lib/image-metadata";
import {
  ImageReencodeError,
  SCAN_RENDITION_MAX_SIDE,
  quantiseHiddenColour,
  type ImageTransparency,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  readImageDimensions,
  sniffImageMime,
  validateImageMeta,
  type AllowedImageMime,
  type ImageDimensions,
} from "@/lib/image-validation";
import {
  imagesErrorCode,
  type ImageOutputOptions,
  type ImageTransform,
  type ImageTransformer,
  type ImagesBinding,
} from "@/lib/image-runtime/images-binding";
import {
  PngCodecError,
  decodePngToRgba,
  encodePngFromRgba,
  pngChunkTypes,
  type RgbaImage,
} from "@/lib/image-runtime/png-codec";

/**
 * Pixel-path cap. One RGBA frame is 4 bytes per pixel and the isolate has 128 MB in total (JS heap and buffers), shared by every
 * request it serves. 12 MP = 48 MB frame, plus the binding's PNG and the compressed output. Measured cost: see the evaluation doc.
 */
export const PIXEL_PATH_MAX_PIXELS = 12_000_000;

/** Fixed encoder settings sent to the binding (same quality as the sharp path's REENCODE_SETTINGS). */
export const CLOUDFLARE_OUTPUT = {
  jpeg: { format: "image/jpeg", quality: 85, anim: false },
  webpLossy: { format: "image/webp", quality: 85, anim: false },
  // https://developers.cloudflare.com/images/optimization/features/#format: "Use quality=100 to return the WebP lossless format."
  webpLossless: { format: "image/webp", quality: 100, anim: false },
  // No quality for PNG: "an explicit quality setting allows the use of PNG8 (palette)", which would be lossy.
  png: { format: "image/png", anim: false },
  rendition: { format: "image/jpeg", quality: 90, anim: false },
} as const satisfies Record<string, ImageOutputOptions>;

/**
 * EXIF orientation -> the transforms that show the stored pixels upright, applied one per `.transform()` call so the order is
 * explicit (flip first, then a clockwise rotation). 5 = transpose, 7 = transverse.
 */
export const ORIENTATION_TRANSFORMS: Record<number, ImageTransform[]> = {
  1: [],
  2: [{ flip: "h" }],
  3: [{ rotate: 180 }],
  4: [{ flip: "v" }],
  5: [{ flip: "h" }, { rotate: 270 }],
  6: [{ rotate: 90 }],
  7: [{ flip: "h" }, { rotate: 90 }],
  8: [{ rotate: 270 }],
};

export type CloudflareReencodeOptions = {
  /** `env.IMAGES`. Missing means "unavailable" (held, nothing published). */
  images: ImagesBinding | null | undefined;
  /** Header pixel cap, checked before any binding call. Defaults to MAX_IMAGE_PIXELS (30 MP). */
  maxPixels?: number;
  /** Pixel-path cap (PNG, WEBP with alpha). Defaults to PIXEL_PATH_MAX_PIXELS. */
  maxPixelPathPixels?: number;
  /** Per binding call. Defaults to 15 s. A timeout is "unavailable". */
  timeoutMs?: number;
  /**
   * Where the pixel path gets its pixels. "png" (default) uses only documented behaviour. "rgba" uses `output({format:"rgba"})`,
   * which is in the binding's type definitions but not in the prose docs (and refused by Wrangler's local mode); it saves the
   * PNG round trip and must be validated on a real account before it is relied on.
   */
  pixelSource?: "png" | "rgba";
};

const DEFAULT_TIMEOUT_MS = 15_000;

/** Binding error codes that say "the platform could not do it now" rather than "this file is bad". */
const UNAVAILABLE_CODES = new Set([
  9422, 9432, 9424, 9504, 9505, 9510, 9516, 9517, 9518, 9519, 9522, 9529,
]);

function mapBindingError(e: unknown): ImageReencodeError {
  if (e instanceof ImageReencodeError) return e;
  const code = imagesErrorCode(e);
  const detail = `images binding${code ? ` ${code}` : ""}: ${String((e as Error)?.message ?? e)}`;
  if (code === 9413 || code === 9402) return new ImageReencodeError("too_large", detail);
  if (code === 9412 || code === 9523 || code === 9520)
    return new ImageReencodeError("unreadable", detail);
  if (code !== null && !UNAVAILABLE_CODES.has(code))
    return new ImageReencodeError("unreadable", detail);
  return new ImageReencodeError("unavailable", detail);
}

async function withTimeout<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ImageReencodeError("unavailable", "images binding timed out")),
      ms,
    );
  });
  try {
    return await Promise.race([
      (async () => {
        try {
          return await run();
        } catch (e) {
          throw mapBindingError(e);
        }
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>;
}

/** Read a binding output, refusing anything larger than `cap` bytes without buffering past it. */
async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new ImageReencodeError("unreadable", "binding output exceeds the size cap");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.byteLength;
  }
  return out;
}

async function run(
  images: ImagesBinding,
  input: Uint8Array,
  transforms: ImageTransform[],
  output: ImageOutputOptions,
  timeoutMs: number,
  cap: number,
): Promise<Uint8Array> {
  return withTimeout(timeoutMs, async () => {
    let t: ImageTransformer = images.input(streamOf(input));
    for (const tr of transforms) t = t.transform(tr);
    const result = await t.output(output);
    const type = result.contentType().split(";")[0].trim().toLowerCase();
    const want = output.format === "rgb" || output.format === "rgba" ? null : output.format;
    if (want && type !== want)
      throw new ImageReencodeError("unreadable", `binding returned ${type}, asked ${want}`);
    return readCapped(result.image(), cap);
  });
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------------------------------------------------------
// Container helpers (pure byte work on the stripper's well-formed output or on binding output).

type WebpFacts = { lossless: boolean; alpha: boolean; vp8xFlags: number | null; chunks: string[] };

function webpFacts(b: Uint8Array): WebpFacts | null {
  const chunks: string[] = [];
  let lossless = false;
  let alpha = false;
  let vp8xFlags: number | null = null;
  let i = 12;
  for (; i + 8 <= b.length;) {
    const fourcc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const size = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    if (i + 8 + size > b.length) return null;
    chunks.push(fourcc);
    if (fourcc === "VP8X" && size >= 1) {
      vp8xFlags = b[i + 8];
      if (vp8xFlags & 0x10) alpha = true;
    } else if (fourcc === "ALPH") alpha = true;
    else if (fourcc === "VP8L" && size >= 5) {
      lossless = true;
      const bits = (b[i + 9] | (b[i + 10] << 8) | (b[i + 11] << 16) | (b[i + 12] << 24)) >>> 0;
      if ((bits >>> 28) & 1) alpha = true;
    }
    i += 8 + size + (size & 1);
  }
  return i === b.length || i === b.length + 1 ? { lossless, alpha, vp8xFlags, chunks } : null;
}

function hasIccProfile(b: Uint8Array, mime: AllowedImageMime): boolean {
  if (mime === "image/png") return (pngChunkTypes(b) ?? []).includes("iCCP");
  if (mime === "image/webp") return (webpFacts(b)?.chunks ?? []).includes("ICCP");
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 0xff) return false;
    const m = b[i + 1];
    if (m === 0xda || m === 0xd9) return false;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xe2 && String.fromCharCode(...b.subarray(i + 4, i + 15)) === "ICC_PROFILE")
      return true;
    i += 2 + len;
  }
  return false;
}

/** Remove the orientation-only EXIF block the stripper writes (its output is well formed, so this is a simple walk). */
export function dropOrientationExif(b: Uint8Array, mime: AllowedImageMime): Uint8Array {
  const parts: Uint8Array[] = [];
  if (mime === "image/jpeg") {
    parts.push(b.subarray(0, 2));
    let i = 2;
    for (; i + 4 <= b.length;) {
      const m = b[i + 1];
      if (m === 0xda) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      const isExif = m === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 10)) === "Exif\0\0";
      if (!isExif) parts.push(b.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    parts.push(b.subarray(i));
  } else if (mime === "image/png") {
    parts.push(b.subarray(0, 8));
    for (let i = 8; i + 12 <= b.length;) {
      const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (type !== "eXIf") parts.push(b.subarray(i, i + 12 + len));
      i += 12 + len;
    }
  } else {
    const body: Uint8Array[] = [];
    for (let i = 12; i + 8 <= b.length;) {
      const size = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      const fourcc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
      const end = Math.min(b.length, i + 8 + size + (size & 1));
      if (fourcc === "VP8X") {
        const c = b.slice(i, end);
        c[8] &= ~0x08; // EXIF flag
        body.push(c);
      } else if (fourcc !== "EXIF") body.push(b.subarray(i, end));
      i = end;
    }
    const n = body.reduce((s, p) => s + p.length, 0);
    const head = new Uint8Array(12);
    head.set(b.subarray(0, 12));
    new DataView(head.buffer).setUint32(4, 4 + n, true);
    parts.push(head, ...body);
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

/** Allow-list of what a re-encoded file may contain. Returns a problem, or null. */
export function outputContainerProblem(b: Uint8Array, mime: AllowedImageMime): string | null {
  if (mime === "image/png") {
    const types = pngChunkTypes(b);
    if (!types) return "PNG structure";
    if (types[0] !== "IHDR" || types[types.length - 1] !== "IEND") return "PNG structure";
    return types.slice(1, -1).every((t) => t === "IDAT") ? null : "PNG has extra chunks";
  }
  if (mime === "image/webp") {
    const f = webpFacts(b);
    if (!f) return "WEBP structure";
    if (!f.chunks.every((c) => c === "VP8X" || c === "ALPH" || c === "VP8 " || c === "VP8L"))
      return "WEBP has extra chunks";
    if (f.vp8xFlags !== null && (f.vp8xFlags & ~0x10) !== 0) return "WEBP VP8X flags metadata";
    return f.chunks.filter((c) => c === "VP8 " || c === "VP8L").length === 1
      ? null
      : "WEBP image data count";
  }
  // JPEG: markers before and between scans must be tables, frame, scan, restart interval or a plain JFIF APP0; nothing after EOI.
  if (b[0] !== 0xff || b[1] !== 0xd8) return "JPEG structure";
  const allowed = new Set([0xdb, 0xc0, 0xc1, 0xc2, 0xc4, 0xdd, 0xda]);
  let i = 2;
  let frames = 0;
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) return "JPEG structure";
    const m = b[i + 1];
    if (m === 0xff) {
      i += 1;
      continue;
    }
    if (m === 0xd9)
      return i + 2 === b.length ? (frames === 1 ? null : "JPEG frames") : "JPEG trailing data";
    if (i + 4 > b.length) return "JPEG structure";
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return "JPEG structure";
    const jfif =
      m === 0xe0 && len === 16 && String.fromCharCode(...b.subarray(i + 4, i + 9)) === "JFIF\0";
    if (!allowed.has(m) && !jfif) return `JPEG marker ${m.toString(16)}`;
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) frames += 1;
    i += 2 + len;
    if (m === 0xda) {
      // Entropy-coded data: skip to the next marker that is not a stuffed 0xFF00 or a restart marker.
      while (
        i + 1 < b.length &&
        !(b[i] === 0xff && b[i + 1] !== 0 && (b[i + 1] < 0xd0 || b[i + 1] > 0xd7))
      )
        i += 1;
    }
  }
  return "JPEG has no EOI";
}

function hasPartialAlpha(data: Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0 && data[i] !== 255) return true;
  return false;
}

/** RGBA `src` composited over an opaque grey level `background` (0 black, 255 white), written to `out` with alpha 255. */
export function flattenInto(out: Uint8Array, src: Uint8Array, background: number): void {
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    const under = background * (255 - a);
    out[i] = Math.round((src[i] * a + under) / 255);
    out[i + 1] = Math.round((src[i + 1] * a + under) / 255);
    out[i + 2] = Math.round((src[i + 2] * a + under) / 255);
    out[i + 3] = 255;
  }
}

function hasAnyAlpha(data: Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// ---------------------------------------------------------------------------------------------------------------------------

/** Re-encode on the Cloudflare Images binding. Same contract as reencodeImage (see the file header). */
export async function reencodeImageWithCloudflareImages(
  input: Uint8Array,
  options: CloudflareReencodeOptions,
): Promise<ReencodeResult> {
  const mime = sniffImageMime(input);
  if (!mime) throw new ImageReencodeError("unsupported");
  const maxPixels = options.maxPixels ?? MAX_IMAGE_PIXELS;
  const pixelCap = Math.min(maxPixels, options.maxPixelPathPixels ?? PIXEL_PATH_MAX_PIXELS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1. Structural pre-check, identical to the sharp path.
  let structural: ReturnType<typeof stripImageMetadata>;
  try {
    structural = stripImageMetadata(input);
  } catch (e) {
    throw new ImageReencodeError("unreadable", String((e as Error)?.message ?? e));
  }
  if (structural.report.animated) throw new ImageReencodeError("animated");
  const orientation = structural.report.orientation ?? null;
  const toSend = dropOrientationExif(structural.bytes, mime);
  const sentReport = inspectImageMetadata(toSend);
  if (sentReport.hasExif || sentReport.orientation || sentReport.hasGps || sentReport.hasXmp)
    throw new ImageReencodeError("unreadable", "metadata left in what would be sent");

  // 2. Size by the header, before the platform decodes anything.
  const stored = readImageDimensions(toSend);
  if (!stored || !stored.width || !stored.height)
    throw new ImageReencodeError("unreadable", "no dimensions");
  if (stored.width * stored.height > maxPixels) throw new ImageReencodeError("too_large");
  const swaps = (orientation ?? 1) >= 5;
  const expected: ImageDimensions = swaps
    ? { width: stored.height, height: stored.width }
    : { width: stored.width, height: stored.height };
  const transforms = ORIENTATION_TRANSFORMS[orientation ?? 1] ?? null;
  if (!transforms) throw new ImageReencodeError("unreadable", "orientation");

  const webp = mime === "image/webp" ? webpFacts(toSend) : null;
  if (mime === "image/webp" && !webp) throw new ImageReencodeError("unreadable", "WEBP structure");
  const pixelPath = mime === "image/png" || !!webp?.alpha;
  const lossless = mime === "image/png" || !!webp?.lossless;
  if (pixelPath && stored.width * stored.height > pixelCap)
    throw new ImageReencodeError("too_large", "pixel path cap");

  const images = options.images;
  if (!images || typeof images.input !== "function" || typeof images.info !== "function")
    throw new ImageReencodeError("unavailable", "no Images binding");

  const info = await withTimeout(timeoutMs, () => images.info(streamOf(toSend)));
  if (
    !("width" in info) ||
    info.format !== mime ||
    info.width !== stored.width ||
    info.height !== stored.height
  )
    throw new ImageReencodeError("unreadable", `binding saw ${JSON.stringify(info)}`);

  const outputCap = MAX_IMAGE_BYTES;
  let bytes: Uint8Array;
  let hasAlpha = false;
  let transparency: ImageTransparency = "none";
  const scanRenditions: string[] = [];

  if (!pixelPath) {
    // 3. Direct path (JPEG, opaque WEBP).
    const out =
      mime === "image/jpeg"
        ? CLOUDFLARE_OUTPUT.jpeg
        : lossless
          ? CLOUDFLARE_OUTPUT.webpLossless
          : CLOUDFLARE_OUTPUT.webpLossy;
    bytes = await run(images, toSend, transforms, out, timeoutMs, outputCap);
    if (!lossless && (sameBytes(bytes, toSend) || sameBytes(bytes, input)))
      throw new ImageReencodeError("unreadable", "binding returned the input unchanged");
  } else {
    // 4. Pixel path (PNG, WEBP that can carry alpha).
    let image: RgbaImage;
    if (options.pixelSource === "rgba") {
      const raw = await run(
        images,
        toSend,
        transforms,
        { format: "rgba", anim: false },
        timeoutMs,
        expected.width * expected.height * 4,
      );
      if (raw.byteLength !== expected.width * expected.height * 4)
        throw new ImageReencodeError("unreadable", "rgba output size");
      image = { width: expected.width, height: expected.height, data: raw };
    } else {
      const png = await run(
        images,
        toSend,
        transforms,
        CLOUDFLARE_OUTPUT.png,
        timeoutMs,
        // A PNG of N RGBA pixels is at most about N*4 plus per-row and deflate overhead.
        pixelCap * 4 + 4 * 1024 * 1024,
      );
      try {
        image = await decodePngToRgba(png, { maxPixels: pixelCap });
      } catch (e) {
        if (e instanceof PngCodecError)
          throw new ImageReencodeError(
            e.kind === "too_large" ? "too_large" : "unreadable",
            e.message,
          );
        throw e;
      }
    }
    if (image.width !== expected.width || image.height !== expected.height)
      throw new ImageReencodeError("unreadable", "decoded size changed");
    // Before any encoder sees them: colour under (near-)transparent pixels is reduced to what compositing shows.
    quantiseHiddenColour(image.data, 4);
    hasAlpha = hasAnyAlpha(image.data);
    const ownPng = await encodePngFromRgba(image, hasAlpha ? 4 : 3);
    if (mime === "image/png") bytes = ownPng;
    else
      bytes = await run(
        images,
        ownPng,
        [],
        lossless ? CLOUDFLARE_OUTPUT.webpLossless : CLOUDFLARE_OUTPUT.webpLossy,
        timeoutMs,
        outputCap,
      );
    if (hasAlpha) {
      // Scan renditions of the quantised pixels (what is published), the same set the sharp path makes (contract v2,
      // src/lib/image-runtime/reencode-contract.ts): flattened on white and on black, plus the colour with the alpha dropped
      // when some alpha is partial. Flattening is done here, not by the binding, so it is exactly these pixels.
      transparency = hasPartialAlpha(image.data) ? "partial" : "binary";
      const toRendition = async (rgb: RgbaImage) => {
        const jpeg = await run(
          images,
          await encodePngFromRgba(rgb, 3),
          [{ width: SCAN_RENDITION_MAX_SIDE, height: SCAN_RENDITION_MAX_SIDE, fit: "scale-down" }],
          CLOUDFLARE_OUTPUT.rendition,
          timeoutMs,
          outputCap,
        );
        if (sniffImageMime(jpeg) !== "image/jpeg")
          throw new ImageReencodeError("unreadable", "scan rendition type");
        return `data:image/jpeg;base64,${toBase64(jpeg)}`;
      };
      const scratch: RgbaImage = {
        width: image.width,
        height: image.height,
        data: new Uint8Array(image.data.length),
      };
      for (const background of [255, 0]) {
        flattenInto(scratch.data, image.data, background);
        scanRenditions.push(await toRendition(scratch));
      }
      if (transparency === "partial") scanRenditions.push(await toRendition(image));
    }
  }

  // 5. Verify what will be scanned and published.
  const dims = readImageDimensions(bytes);
  const report = inspectImageMetadata(bytes);
  const outWebp = mime === "image/webp" ? webpFacts(bytes) : null;
  const problem =
    sniffImageMime(bytes) !== mime
      ? "output type changed"
      : !dims || dims.width !== expected.width || dims.height !== expected.height
        ? "output size changed"
        : report.animated
          ? "output is animated"
          : report.hasExif ||
              report.hasGps ||
              report.hasXmp ||
              report.hasOther ||
              report.orientation
            ? "output carries metadata the stripper would remove"
            : (outputContainerProblem(bytes, mime) ??
              (mime === "image/webp" && !!outWebp?.alpha !== hasAlpha
                ? "output alpha changed"
                : mime === "image/webp" && lossless && !outWebp?.lossless
                  ? "lossless WEBP came back lossy"
                  : validateImageMeta({ mime, bytes: bytes.byteLength, dimensions: expected })));
  if (problem) throw new ImageReencodeError("unreadable", problem);
  const check = await withTimeout(timeoutMs, () => images.info(streamOf(bytes)));
  if (
    !("width" in check) ||
    check.format !== mime ||
    check.width !== expected.width ||
    check.height !== expected.height
  )
    throw new ImageReencodeError("unreadable", "binding does not read the output back");

  return {
    bytes,
    mime,
    width: expected.width,
    height: expected.height,
    hasAlpha,
    orientation,
    convertedFromIcc: hasIccProfile(toSend, mime),
    lossless,
    inputReport: structural.report,
    scanRenditions,
    transparency,
  };
}
