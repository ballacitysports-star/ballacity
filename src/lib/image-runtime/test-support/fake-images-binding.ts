/**
 * TEST SUPPORT ONLY. Two fakes of the Cloudflare Images binding, both built on sharp. Neither is Cloudflare: no result obtained
 * with them is evidence of how the real platform behaves. They exist to exercise the PoC's logic against the behaviour the
 * documentation describes, and against Wrangler's local mode.
 *
 * 1. createDocumentedImagesFake: models what https://developers.cloudflare.com/images/ documents for production:
 *    - `.input()` takes at most 20 MB (get-started/limits, "Limits for the Images binding");
 *    - inputs JPEG, PNG, GIF, WebP (incl. animation), SVG, AVIF, HEIC; area at most 100 MP (error 9413);
 *    - "Color profiles and EXIF rotation are applied to the image even if the metadata is discarded" (features/#metadata);
 *    - PNG and WebP output discard all metadata; JPEG keeps the EXIF copyright tag by default (`metadata=copyright`), NOT modelled
 *      here because the PoC never sends EXIF (a test asserts that);
 *    - transforms applied in the order of the `.transform()` calls (optimization/binding); flip then rotate inside one call;
 *    - `anim` true by default (animation kept), false = first frame (features/#anim);
 *    - WebP quality 100 = lossless (features/#format); PNG with a quality = palette (PNG8, lossy) (features/#quality);
 *    - `.info()` returns format, fileSize, width, height and nothing about frames (optimization/binding/#infostream);
 *    - the raw `rgb`/`rgba` output formats from the type definitions (headerless pixels, an ASSUMPTION).
 *    Where the docs are silent the fake takes the WORST case for the PoC: the colour under fully transparent pixels is kept by
 *    lossless outputs (sharp keeps it; libwebp lossless with `exact`), so the PoC has to remove it itself.
 * 2. createLocalModeImagesFake: a port of Wrangler's offline ("low-fidelity") Images implementation, miniflare
 *    5.20260908.0-alpha `dist/src/index.js`, `src/plugins/images/fetcher.ts` (imagesLocalFetcher/runInfo/runTransform): `sharp(buf, {})`
 *    with default options, only `rotate`/`width`/`height` honoured (flip ignored), no EXIF auto-orientation, no `quality`/`anim`,
 *    GIF and RGB/RGBA output refused with 9520. Spot-checked against the real Wrangler 4.130.0 local mode (see the evaluation doc).
 */
import sharp, { type Metadata as SharpMetadata } from "sharp";
import type {
  ImageInfoResponse,
  ImageOutputOptions,
  ImageTransform,
  ImageTransformationResult,
  ImageTransformer,
  ImagesBinding,
} from "@/lib/image-runtime/images-binding";

export class FakeImagesError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(`IMAGES_TRANSFORM_ERROR ${code}: ${message}`);
    this.code = code;
  }
}

export type FakeCall = {
  op: "info" | "output";
  input: Uint8Array;
  transforms: ImageTransform[];
  output?: ImageOutputOptions;
};

export type FakeHooks = {
  /** Return an error to throw instead of doing the call. */
  fail?: (call: FakeCall, index: number) => unknown;
  /** Rewrite a successful output (to simulate a platform that adds metadata, passes input through, ...). */
  tamper?: (bytes: Uint8Array, call: FakeCall) => Uint8Array;
  /** Override `.contentType()`. */
  contentType?: (call: FakeCall) => string;
  /** Override `.info()`. */
  info?: (real: ImageInfoResponse, call: FakeCall) => ImageInfoResponse;
  /** Wait this long before answering (timeouts). */
  delayMs?: number;
};

export type FakeBinding = ImagesBinding & { calls: FakeCall[] };

const INPUT_LIMIT = 20 * 1024 * 1024;
const AREA_LIMIT = 100_000_000;

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  heif: "image/avif",
};

function result(bytes: Uint8Array, type: string): ImageTransformationResult {
  return {
    contentType: () => type,
    image: () => new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>,
    response: () => new Response(bytes as BodyInit, { headers: { "content-type": type } }),
  };
}

type Engine = {
  info(bytes: Uint8Array): Promise<ImageInfoResponse>;
  output(
    bytes: Uint8Array,
    transforms: ImageTransform[],
    out: ImageOutputOptions,
  ): Promise<[Uint8Array, string]>;
};

function makeBinding(engine: Engine, hooks: FakeHooks): FakeBinding {
  const calls: FakeCall[] = [];
  const pause = () =>
    hooks.delayMs ? new Promise((r) => setTimeout(r, hooks.delayMs)) : Promise.resolve();
  const transformer = (
    stream: ReadableStream<Uint8Array>,
    transforms: ImageTransform[],
  ): ImageTransformer => ({
    transform: (t) => transformer(stream, [...transforms, t]),
    async output(out) {
      const input = await readAll(stream);
      const call: FakeCall = { op: "output", input, transforms, output: out };
      const index = calls.push(call) - 1;
      await pause();
      const injected = hooks.fail?.(call, index);
      if (injected) throw injected;
      const [bytes, type] = await engine.output(input, transforms, out);
      return result(
        hooks.tamper ? hooks.tamper(bytes, call) : bytes,
        hooks.contentType?.(call) ?? type,
      );
    },
  });
  return {
    calls,
    async info(stream) {
      const input = await readAll(stream);
      const call: FakeCall = { op: "info", input, transforms: [] };
      const index = calls.push(call) - 1;
      await pause();
      const injected = hooks.fail?.(call, index);
      if (injected) throw injected;
      const real = await engine.info(input);
      return hooks.info ? hooks.info(real, call) : real;
    },
    input: (stream) => transformer(stream, []),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------

async function documentedInfo(bytes: Uint8Array): Promise<ImageInfoResponse> {
  if (bytes.byteLength > INPUT_LIMIT) throw new FakeImagesError(9402, "input over 20 MB");
  let m: SharpMetadata;
  try {
    m = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new FakeImagesError(9412, "not an image");
  }
  const format = MIME[m.format ?? ""];
  if (!format) throw new FakeImagesError(9520, `unsupported ${m.format}`);
  if (format === "image/svg+xml") return { format };
  return { format, fileSize: bytes.byteLength, width: m.width!, height: m.height! };
}

async function documentedOutput(
  bytes: Uint8Array,
  transforms: ImageTransform[],
  out: ImageOutputOptions,
): Promise<[Uint8Array, string]> {
  if (bytes.byteLength > INPUT_LIMIT) throw new FakeImagesError(9402, "input over 20 MB");
  let meta: SharpMetadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new FakeImagesError(9412, "not an image");
  }
  if (!MIME[meta.format ?? ""] || meta.format === "svg") throw new FakeImagesError(9520, "format");
  const animated = (meta.pages ?? 1) > 1 && out.anim !== false;
  if ((meta.width ?? 0) * (meta.pageHeight ?? meta.height ?? 0) * (meta.pages ?? 1) > AREA_LIMIT)
    throw new FakeImagesError(9413, "area over 100 MP");

  try {
    if (animated) {
      // Animation kept: no per-frame transform modelling is needed by the tests (the PoC refuses animation first).
      const img = sharp(bytes, { animated: true });
      const enc = out.format === "image/gif" ? img.gif() : img.webp({ quality: out.quality ?? 85 });
      const type = out.format === "image/gif" ? "image/gif" : "image/webp";
      return [new Uint8Array(await enc.toBuffer()), type];
    }
    // Decode: EXIF rotation and colour profile applied (documented), to 8-bit sRGB pixels.
    let state = await sharp(bytes, { failOn: "error", limitInputPixels: false })
      .autoOrient()
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
    const wrap = () =>
      sharp(state.data, {
        raw: {
          width: state.info.width,
          height: state.info.height,
          channels: state.info.channels as 1 | 2 | 3 | 4,
        },
      });
    for (const t of transforms) {
      // Inside one call flip is applied before rotate (features/#flip); separate calls run in call order.
      if (t.flip) {
        let p = wrap();
        if (t.flip.includes("h")) p = p.flop();
        if (t.flip.includes("v")) p = p.flip();
        state = await p.raw().toBuffer({ resolveWithObject: true });
      }
      if (t.rotate)
        state = await wrap().rotate(t.rotate).raw().toBuffer({ resolveWithObject: true });
      if (t.width || t.height) {
        const fit =
          t.fit === "scale-down" || !t.fit ? "inside" : t.fit === "contain" ? "inside" : "cover";
        state = await wrap()
          .resize(t.width ?? null, t.height ?? null, {
            fit,
            withoutEnlargement: t.fit === "scale-down" || !t.fit,
          })
          .raw()
          .toBuffer({ resolveWithObject: true });
      }
    }
    const p = wrap();
    switch (out.format) {
      case "image/jpeg":
        return [
          new Uint8Array(
            await p
              .flatten({ background: out.background ?? "#ffffff" })
              .jpeg({ quality: out.quality ?? 85, progressive: true })
              .toBuffer(),
          ),
          "image/jpeg",
        ];
      case "image/png":
        return [
          new Uint8Array(
            await (
              out.quality ? p.png({ palette: true, quality: out.quality }) : p.png()
            ).toBuffer(),
          ),
          "image/png",
        ];
      case "image/webp":
        return [
          new Uint8Array(
            await (
              out.quality === 100
                ? p.webp({ lossless: true, exact: true })
                : p.webp({ quality: out.quality ?? 85, alphaQuality: 100 })
            ).toBuffer(),
          ),
          "image/webp",
        ];
      case "rgba":
        return [new Uint8Array(await p.ensureAlpha().raw().toBuffer()), "application/octet-stream"];
      case "rgb":
        return [new Uint8Array(await p.removeAlpha().raw().toBuffer()), "application/octet-stream"];
      default:
        throw new FakeImagesError(9520, `output ${out.format} not modelled`);
    }
  } catch (e) {
    if (e instanceof FakeImagesError) throw e;
    throw new FakeImagesError(9523, String((e as Error)?.message ?? e));
  }
}

/** Fake of the production binding as documented (see the file header). */
export function createDocumentedImagesFake(hooks: FakeHooks = {}): FakeBinding {
  return makeBinding({ info: documentedInfo, output: documentedOutput }, hooks);
}

// ---------------------------------------------------------------------------------------------------------------------------

async function localInfo(bytes: Uint8Array): Promise<ImageInfoResponse> {
  let m: SharpMetadata;
  try {
    m = await sharp(bytes, {}).metadata();
  } catch (e) {
    throw new FakeImagesError(9523, `Unexpected error response 500: ${String(e)}`);
  }
  const format = MIME[m.format ?? ""];
  if (!format)
    throw new FakeImagesError(
      9520,
      `Unsupported image type ${m.format}, expected one of: JPEG, SVG, PNG, WebP, GIF or AVIF`,
    );
  if (format === "image/svg+xml") return { format };
  if (!m.size || !m.width || !m.height)
    throw new FakeImagesError(9523, "Expected size, width and height for bitmap input");
  return { format, fileSize: m.size, width: m.width, height: m.height };
}

async function localOutput(
  bytes: Uint8Array,
  transforms: ImageTransform[],
  out: ImageOutputOptions,
): Promise<[Uint8Array, string]> {
  // runTransform(): one sharp pipeline, rotate()/resize() called per transform in order, everything else ignored.
  const transformer = sharp(bytes, {});
  for (const t of transforms) {
    if (t.rotate !== undefined) transformer.rotate(t.rotate);
    if (t.width !== undefined || t.height !== undefined)
      transformer.resize(t.width || null, t.height || null, {
        fit: "inside",
        withoutEnlargement: t.fit === "scale-down" || t.fit === undefined,
        background: t.background ?? (t.fit === "pad" ? "#ffffff" : undefined),
      });
  }
  let type: string = out.format;
  switch (out.format) {
    case "image/avif":
      transformer.avif();
      break;
    case "image/gif":
      throw new FakeImagesError(9520, "ERROR: GIF output is not supported in local mode");
    case "image/jpeg":
      transformer.jpeg();
      break;
    case "image/png":
      transformer.png();
      break;
    case "image/webp":
      transformer.webp();
      break;
    case "rgb":
    case "rgba":
      throw new FakeImagesError(9520, "ERROR: RGB/RGBA output is not supported in local mode");
    default:
      transformer.jpeg();
      type = "image/jpeg";
  }
  try {
    return [new Uint8Array(await transformer.toBuffer()), type];
  } catch (e) {
    throw new FakeImagesError(9523, `Unexpected error response 500: ${String(e)}`);
  }
}

/** Port of Wrangler's offline Images implementation (see the file header). */
export function createLocalModeImagesFake(hooks: FakeHooks = {}): FakeBinding {
  return makeBinding({ info: localInfo, output: localOutput }, hooks);
}
