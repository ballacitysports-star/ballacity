/**
 * Canonical re-encoding of an uploaded picture before it is scanned and published (SEC-6, review finding M2).
 *
 * WHY. The byte-level stripper (src/lib/image-metadata.ts) removes personal metadata but copies the data it keeps verbatim:
 * the ICC profile, the bytes before a JPEG EOI, duplicate PNG/WEBP chunks, extra IDAT, unchecked CRCs. Any of those can
 * carry an arbitrary payload, including a whole second picture the safety scanner never looks at. Decoding to pixels and
 * encoding a fresh file from those pixels leaves nothing of the uploaded container behind: only what a decoder draws.
 *
 * PIPELINE (see docs/privacy/sec6-image-reencode-quarantine.md, "Format matrix"):
 *   1. sniff the real type from magic bytes: JPEG, PNG or WEBP only, anything else is refused ("unsupported");
 *   2. run the byte stripper as a structural pre-check (defence in depth): it refuses malformed containers before the native
 *      decoder parses them, reports APNG/animated WEBP (libvips does not flag APNG), and its output, not the upload, is what
 *      the decoder reads, so EXIF maker notes, XMP, IPTC and text chunks never reach a native parser. It keeps the ICC profile
 *      (needed for the colour conversion) and writes an orientation-only EXIF block of its own making;
 *   3. decode with sharp, capped by `limitInputPixels` (decompression bombs) and failing on decoder errors;
 *   4. apply the EXIF orientation to the pixels, convert to sRGB using the embedded profile, and encode a new file of the
 *      same type (so the published name keeps its extension) with fixed settings and NO metadata: no EXIF, no XMP, no ICC;
 *   5. verify the output: same type, the expected (oriented) dimensions, a single frame, no EXIF/ICC/XMP/IPTC, and nothing
 *      the byte inspector would strip.
 * The caller scans exactly the returned bytes and publishes exactly those bytes.
 *
 * RUNTIME. sharp is a native module (libvips). It is loaded lazily and only on the server. Where it cannot load (for example a
 * Workers runtime without native modules) the call fails with code "unavailable", and callers fail closed: nothing is
 * published, the staged original stays private. See the doc's "Runtime" section: this must be resolved before release.
 */
import type SharpType from "sharp";
import type { Metadata as SharpMetadata } from "sharp";
import {
  inspectImageMetadata,
  stripImageMetadata,
  type MetadataReport,
} from "@/lib/image-metadata";
import {
  MAX_IMAGE_PIXELS,
  sniffImageMime,
  validateImageMeta,
  type AllowedImageMime,
} from "@/lib/image-validation";

type SharpFactory = typeof SharpType;

/**
 * Encoder settings, fixed so a given input always produces the same output (a retry publishes identical bytes).
 * JPEG q85 with 4:2:0 chroma is visually transparent for phone photos at the sizes the app shows; PNG is lossless; a lossless
 * WEBP stays lossless, a lossy one is q85 with full-quality alpha.
 */
export const REENCODE_SETTINGS = {
  jpeg: {
    quality: 85,
    chromaSubsampling: "4:2:0",
    progressive: false,
    mozjpeg: false,
    optimiseCoding: true,
  },
  png: { compressionLevel: 9, adaptiveFiltering: true, palette: false },
  // `exact` is set explicitly (finding 1). Lossy: false, libwebp may rewrite the colour under transparent pixels for compression
  // (the input there is already quantised, see quantiseHiddenColour). Lossless: true, so the published colour is exactly the
  // quantised colour; with false, libwebp fills fully transparent pixels with colour predicted from their neighbours instead of
  // the zero quantiseHiddenColour wrote (not upload data, but not verifiably zero either; measured in the tests).
  webpLossy: { quality: 85, alphaQuality: 100, effort: 4, smartSubsample: true, exact: false },
  webpLossless: { lossless: true, effort: 4, exact: true },
} as const;

/**
 * Remove colour that transparency hides (final review 780eaf8f, finding 1). A lossless encoder keeps the RGB of a pixel whose alpha
 * is 0 or 1 exactly, so a second picture can ride in the colour values of transparent pixels: invisible once composited (which is
 * what the safety scanner sees), recoverable by anyone who drops the alpha channel. Each pixel's colour is premultiplied by its
 * alpha and quantised back, keeping only what compositing can show:
 *   rgb = a ? round(round(rgb * a / 255) * 255 / a) : 0
 * alpha 0 becomes black, alpha 1 keeps one bit per channel (0 or 255), alpha 255 is unchanged. Operates in place on interleaved
 * 8-bit pixels whose last channel is alpha (2 = grey+alpha, 4 = RGBA); any other layout has no alpha and is left alone.
 */
export function quantiseHiddenColour(data: Uint8Array, channels: number): void {
  if (channels !== 2 && channels !== 4) return;
  const colour = channels - 1;
  for (let i = 0; i < data.length; i += channels) {
    const a = data[i + colour];
    if (a === 255) continue;
    for (let c = 0; c < colour; c += 1) {
      data[i + c] = a === 0 ? 0 : Math.round((Math.round((data[i + c] * a) / 255) * 255) / a);
    }
  }
}

export type ReencodeErrorCode =
  "unsupported" | "animated" | "too_large" | "unreadable" | "unavailable";

export const REENCODE_MESSAGES: Record<ReencodeErrorCode, string> = {
  unsupported: "Only JPG, PNG or WEBP images are allowed",
  animated: "Animated images can't be used here. Please choose a still JPG, PNG or WEBP picture.",
  too_large: "Image resolution is too high",
  unreadable: "This image could not be processed. Please try a different photo.",
  unavailable: "Image processing is temporarily unavailable. Please try again in a few minutes.",
};

export class ImageReencodeError extends Error {
  readonly code: ReencodeErrorCode;
  constructor(code: ReencodeErrorCode, detail?: string) {
    super(REENCODE_MESSAGES[code]);
    this.name = "ImageReencodeError";
    this.code = code;
    if (detail) this.cause = detail;
  }
}

export type ReencodeResult = {
  /** The new file. Scan these bytes and publish these bytes; nothing else. */
  bytes: Uint8Array;
  mime: AllowedImageMime;
  width: number;
  height: number;
  hasAlpha: boolean;
  /** The EXIF orientation that was applied to the pixels (1 or null: none). */
  orientation: number | null;
  /** The upload carried an ICC profile; its colours were converted to sRGB and the profile was not kept. */
  convertedFromIcc: boolean;
  lossless: boolean;
  /** What the byte inspector found in the upload (for the moderation record: counts and flags only). */
  inputReport: MetadataReport;
  /**
   * SCAN ONLY, never published or stored. Present when the picture has partially transparent pixels (0 < alpha < 255): the
   * published colour with the alpha channel dropped, as a JPEG data URL of at most SCAN_RENDITION_MAX_SIDE px per side. After
   * quantiseHiddenColour, a pixel at low alpha still keeps a posterised colour (alpha 16: about 4 bits per channel), which is
   * nearly invisible when composited (what the scanner sees of `bytes`) but a recognisable picture to anyone who drops the
   * alpha. Callers scan this too and treat a flag (or a failed scan) on it like one on `bytes`.
   */
  alphaRemovedScanTarget: string | null;
};

/** Longest side of the alpha-removed scan rendition (scanners downscale far below this). */
export const SCAN_RENDITION_MAX_SIDE = 2048;

/** Any pixel whose alpha is neither 0 (colour already zeroed) nor 255 (fully visible)? */
function hasPartialAlpha(data: Uint8Array, channels: number): boolean {
  if (channels !== 2 && channels !== 4) return false;
  for (let i = channels - 1; i < data.length; i += channels) {
    const a = data[i];
    if (a !== 0 && a !== 255) return true;
  }
  return false;
}

export type ReencodeOptions = {
  /** Test seam: how sharp is loaded. Defaults to a lazy server-only import. */
  loadSharp?: () => Promise<SharpFactory>;
  /** Pixel cap passed to sharp's limitInputPixels. Defaults to MAX_IMAGE_PIXELS. */
  maxPixels?: number;
};

// A variable specifier with @vite-ignore keeps the bundler from pulling the native module into a client or Workers bundle.
const SHARP_MODULE = "sharp";
let sharpPromise: Promise<SharpFactory> | null = null;
async function defaultLoadSharp(): Promise<SharpFactory> {
  sharpPromise ??= (async () => {
    const mod = (await import(/* @vite-ignore */ SHARP_MODULE)) as {
      default?: SharpFactory;
    } & SharpFactory;
    const sharp = (mod.default ?? mod) as SharpFactory;
    // No libvips operation cache: decoded user pictures must not linger in process memory between requests.
    sharp.cache(false);
    return sharp;
  })().catch((e) => {
    sharpPromise = null;
    throw e;
  });
  return sharpPromise;
}

const FORMAT_OF: Record<AllowedImageMime, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A WEBP whose image data is lossless (a top-level VP8L chunk). */
function isLosslessWebp(b: Uint8Array): boolean {
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (fourcc === "VP8L") return true;
    if (fourcc === "VP8 ") return false;
    const size = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    i += 8 + size + (size & 1);
  }
  return false;
}

/**
 * Decode `input` and encode a fresh file of the same type with no metadata (see the file header). Throws ImageReencodeError;
 * its message is safe to show the uploader.
 */
export async function reencodeImage(
  input: Uint8Array,
  options: ReencodeOptions = {},
): Promise<ReencodeResult> {
  const mime = sniffImageMime(input);
  if (!mime) throw new ImageReencodeError("unsupported");
  const format = FORMAT_OF[mime];
  const maxPixels = options.maxPixels ?? MAX_IMAGE_PIXELS;

  // Structural pre-check (defence in depth, see the header). A container the allow-list parser refuses is never decoded.
  let structural: ReturnType<typeof stripImageMetadata>;
  try {
    structural = stripImageMetadata(input);
  } catch (e) {
    throw new ImageReencodeError("unreadable", String((e as Error)?.message ?? e));
  }
  if (structural.report.animated) throw new ImageReencodeError("animated");
  const decodable = structural.bytes;

  let sharp: SharpFactory;
  try {
    sharp = await (options.loadSharp ?? defaultLoadSharp)();
  } catch (e) {
    throw new ImageReencodeError("unavailable", String((e as Error)?.message ?? e));
  }

  const open = (bytes: Uint8Array) =>
    sharp(bytes, {
      limitInputPixels: maxPixels,
      failOn: "error",
      sequentialRead: true,
      animated: false,
    });

  let meta: SharpMetadata;
  try {
    meta = await open(decodable).metadata();
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    throw new ImageReencodeError(
      /pixel limit/i.test(message) ? "too_large" : "unreadable",
      message,
    );
  }
  if (meta.format !== format)
    throw new ImageReencodeError("unsupported", `decoder saw ${meta.format}`);
  if ((meta.pages ?? 1) > 1) throw new ImageReencodeError("animated");
  if (!meta.width || !meta.height) throw new ImageReencodeError("unreadable", "no dimensions");
  if (meta.width * meta.height > maxPixels) throw new ImageReencodeError("too_large");

  // Orientation: the stripper keeps the Orientation tag alone, in an EXIF block it writes itself. sharp must read the same value.
  const orientation = structural.report.orientation ?? null;
  if ((meta.orientation ?? 1) !== (orientation ?? 1)) {
    throw new ImageReencodeError("unreadable", "orientation mismatch");
  }
  const swaps = (orientation ?? 1) >= 5;
  const expected = swaps
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };

  const lossless = format === "png" || (format === "webp" && isLosslessWebp(decodable));
  let out: Buffer;
  let alphaRemovedScanTarget: string | null = null;
  try {
    // Decode to raw 8-bit sRGB pixels: autoOrient() applies the orientation, toColourspace('srgb') converts through the embedded
    // profile (when there is one). The new file is then encoded from those pixels alone, so NOTHING else from the upload can reach
    // it: libvips would otherwise carry values such as the PNG pHYs resolution (9 uploader-chosen bytes) into the output. No
    // keepMetadata()/withMetadata()/keepIccProfile(): sharp writes no EXIF, XMP, IPTC or ICC.
    const decoded = await open(decodable)
      .autoOrient()
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    // Before any encoder sees them: colour under (near-)transparent pixels is reduced to what compositing shows.
    quantiseHiddenColour(decoded.data, channels);
    const pipeline = sharp(decoded.data, {
      raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
      limitInputPixels: maxPixels,
    });
    if (format === "jpeg") out = await pipeline.jpeg({ ...REENCODE_SETTINGS.jpeg }).toBuffer();
    else if (format === "png") out = await pipeline.png({ ...REENCODE_SETTINGS.png }).toBuffer();
    else
      out = await pipeline
        .webp(lossless ? { ...REENCODE_SETTINGS.webpLossless } : { ...REENCODE_SETTINGS.webpLossy })
        .toBuffer();
    if (hasPartialAlpha(decoded.data, channels)) {
      // The quantised colour (what is published) with the alpha channel dropped: what a viewer sees after removing transparency.
      const rendition = await sharp(decoded.data, {
        raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
        limitInputPixels: maxPixels,
      })
        .removeAlpha()
        .resize(SCAN_RENDITION_MAX_SIDE, SCAN_RENDITION_MAX_SIDE, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();
      alphaRemovedScanTarget = `data:image/jpeg;base64,${rendition.toString("base64")}`;
    }
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    throw new ImageReencodeError(
      /pixel limit/i.test(message) ? "too_large" : "unreadable",
      message,
    );
  }
  const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);

  // Verify what will be scanned and published.
  let check: SharpMetadata;
  try {
    check = await open(bytes).metadata();
  } catch (e) {
    throw new ImageReencodeError("unreadable", String((e as Error)?.message ?? e));
  }
  const report = inspectImageMetadata(bytes);
  const problem =
    sniffImageMime(bytes) !== mime || check.format !== format
      ? "output type changed"
      : check.width !== expected.width || check.height !== expected.height
        ? "output size changed"
        : (check.pages ?? 1) > 1 || report.animated
          ? "output is animated"
          : check.exif || check.icc || check.xmp || check.iptc || check.orientation
            ? "output carries metadata"
            : report.hasExif ||
                report.hasGps ||
                report.hasXmp ||
                report.hasOther ||
                report.orientation
              ? "output carries metadata the stripper would remove"
              : validateImageMeta({ mime, bytes: bytes.byteLength, dimensions: expected });
  if (problem) throw new ImageReencodeError("unreadable", problem);

  return {
    bytes,
    mime,
    width: expected.width,
    height: expected.height,
    hasAlpha: !!check.hasAlpha,
    orientation,
    convertedFromIcc: !!meta.icc,
    lossless,
    inputReport: structural.report,
    alphaRemovedScanTarget,
  };
}
