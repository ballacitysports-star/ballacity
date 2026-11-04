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
  webpLossy: { quality: 85, alphaQuality: 100, effort: 4, smartSubsample: true },
  webpLossless: { lossless: true, effort: 4 },
} as const;

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
};

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
  };
}
