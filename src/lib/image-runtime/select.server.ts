/**
 * The image-processing runtime, chosen by configuration (audit F09). Wired into both upload paths: promoteStagedImageUpload and
 * the legacy finalizeImageUpload (src/lib/image-uploads.functions.ts) pass `reencode: imageReencoderFromProcessEnv().reencode`.
 *
 *   IMAGE_RUNTIME unset, "disabled", or any unknown value (the default)
 *                                    every call fails closed with "unavailable": promotion holds the upload, nothing is published.
 *   IMAGE_RUNTIME=sharp-node         the Node sharp service, via IMAGE_PROCESSOR_URL and IMAGE_PROCESSOR_SECRET; misconfigured
 *                                    means "unavailable". The recommended runtime (docs/privacy/image-runtime-evaluation.md).
 *   IMAGE_RUNTIME=sharp-in-process   reencodeImage in this process. Only where native sharp loads (a Node host: local
 *                                    development, tests); on Workers sharp cannot load and every call is "unavailable".
 *   IMAGE_RUNTIME=cloudflare-images  the Images binding (env.IMAGES). Not plumbed from the Worker env yet, so through
 *                                    imageReencoderFromProcessEnv it is always "unavailable" (fail closed).
 *
 * Every runtime's result is checked against the one result contract (reencode-contract.ts, version 2) before the caller sees
 * it; a runtime that breaks it is "unavailable" (held), never a published picture with part of it unscanned. There is no
 * fallback from one runtime to another.
 */
import {
  ImageReencodeError,
  reencodeImage,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import { reencodeImageWithCloudflareImages } from "@/lib/image-runtime/cloudflare-images.server";
import type { ImagesBinding } from "@/lib/image-runtime/images-binding";
import { MIN_SECRET_BYTES } from "@/lib/image-runtime/hmac";
import {
  createImageProcessorReencoder,
  isAllowedProcessorUrl,
} from "@/lib/image-runtime/node-service-client";
import { reencodeResultProblem } from "@/lib/image-runtime/reencode-contract";

export const IMAGE_RUNTIMES = [
  "sharp-node",
  "sharp-in-process",
  "cloudflare-images",
  "disabled",
] as const;
export type ImageRuntime = (typeof IMAGE_RUNTIMES)[number];

export type ImageRuntimeEnv = {
  IMAGE_RUNTIME?: string;
  IMAGE_PROCESSOR_URL?: string;
  IMAGE_PROCESSOR_SECRET?: string;
  IMAGES?: ImagesBinding;
};

export function parseImageRuntime(value: string | undefined): ImageRuntime {
  const v = (value ?? "").trim();
  return (IMAGE_RUNTIMES as readonly string[]).includes(v) ? (v as ImageRuntime) : "disabled";
}

export type ImageReencoder = (bytes: Uint8Array) => Promise<ReencodeResult>;

const failClosed =
  (detail: string): ImageReencoder =>
  async () => {
    throw new ImageReencodeError("unavailable", detail);
  };

/** The runtime's result, or "unavailable" when it breaks the result contract. */
export function checkedReencoder(runtime: ImageRuntime, inner: ImageReencoder): ImageReencoder {
  return async (bytes) => {
    const result = await inner(bytes);
    const problem = reencodeResultProblem(result);
    if (problem)
      throw new ImageReencodeError(
        "unavailable",
        `${runtime} broke the result contract: ${problem}`,
      );
    return result;
  };
}

export type SelectOptions = {
  /** Test seam for IMAGE_RUNTIME=sharp-in-process. */
  inProcess?: ImageReencoder;
};

export function selectImageReencoder(
  env: ImageRuntimeEnv,
  options: SelectOptions = {},
): {
  runtime: ImageRuntime;
  reencode: ImageReencoder;
} {
  const runtime = parseImageRuntime(env.IMAGE_RUNTIME);
  if (runtime === "cloudflare-images") {
    const images = env.IMAGES;
    return {
      runtime,
      reencode: images
        ? checkedReencoder(runtime, (bytes) => reencodeImageWithCloudflareImages(bytes, { images }))
        : failClosed("IMAGE_RUNTIME=cloudflare-images without an IMAGES binding"),
    };
  }
  if (runtime === "sharp-node") {
    const url = env.IMAGE_PROCESSOR_URL ?? "";
    const secret = env.IMAGE_PROCESSOR_SECRET ?? "";
    const ok =
      isAllowedProcessorUrl(url) && new TextEncoder().encode(secret).byteLength >= MIN_SECRET_BYTES;
    return {
      runtime,
      reencode: ok
        ? checkedReencoder(runtime, createImageProcessorReencoder({ url, secret }))
        : failClosed("IMAGE_RUNTIME=sharp-node without a valid IMAGE_PROCESSOR_URL/SECRET"),
    };
  }
  if (runtime === "sharp-in-process") {
    return {
      runtime,
      reencode: checkedReencoder(runtime, options.inProcess ?? ((bytes) => reencodeImage(bytes))),
    };
  }
  return { runtime: "disabled", reencode: failClosed("IMAGE_RUNTIME=disabled") };
}

/**
 * The runtime the server functions use, from the process environment (on Workers, nodejs_compat fills process.env from the
 * Worker's vars and secrets, as for the app's other secrets). The Images binding is not read here: see the header.
 */
export function imageReencoderFromProcessEnv(
  env: Record<string, string | undefined> = process.env,
): ReturnType<typeof selectImageReencoder> {
  return selectImageReencoder({
    IMAGE_RUNTIME: env.IMAGE_RUNTIME,
    IMAGE_PROCESSOR_URL: env.IMAGE_PROCESSOR_URL,
    IMAGE_PROCESSOR_SECRET: env.IMAGE_PROCESSOR_SECRET,
  });
}
