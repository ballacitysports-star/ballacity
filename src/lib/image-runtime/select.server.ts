/**
 * Feature-flagged seam for the image-processing runtime. NOT WIRED INTO THE APP: promoteStagedImage and finalizeDirectImageUpload
 * still use their default (`reencodeImage`, sharp loaded lazily, "unavailable" in Workers). Wiring is one line per call site,
 * `reencode: selectImageReencoder(env).reencode`, and is the owner's decision (docs/privacy/image-runtime-evaluation.md, "Wiring").
 *
 *   IMAGE_RUNTIME=disabled           (default, also for any unknown value) every call fails closed with "unavailable": promotion
 *                                    holds the upload, nothing is published.
 *   IMAGE_RUNTIME=sharp-node         the Node sharp service, via IMAGE_PROCESSOR_URL and IMAGE_PROCESSOR_SECRET; misconfigured
 *                                    means "unavailable".
 *   IMAGE_RUNTIME=cloudflare-images  the Images binding (env.IMAGES); missing binding means "unavailable".
 */
import { ImageReencodeError, type ReencodeResult } from "@/lib/image-reencode.server";
import { reencodeImageWithCloudflareImages } from "@/lib/image-runtime/cloudflare-images.server";
import type { ImagesBinding } from "@/lib/image-runtime/images-binding";
import { MIN_SECRET_BYTES } from "@/lib/image-runtime/hmac";
import {
  createImageProcessorReencoder,
  isAllowedProcessorUrl,
} from "@/lib/image-runtime/node-service-client";

export const IMAGE_RUNTIMES = ["sharp-node", "cloudflare-images", "disabled"] as const;
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

export function selectImageReencoder(env: ImageRuntimeEnv): {
  runtime: ImageRuntime;
  reencode: ImageReencoder;
} {
  const runtime = parseImageRuntime(env.IMAGE_RUNTIME);
  if (runtime === "cloudflare-images") {
    const images = env.IMAGES;
    return {
      runtime,
      reencode: images
        ? (bytes) => reencodeImageWithCloudflareImages(bytes, { images })
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
        ? createImageProcessorReencoder({ url, secret })
        : failClosed("IMAGE_RUNTIME=sharp-node without a valid IMAGE_PROCESSOR_URL/SECRET"),
    };
  }
  return { runtime: "disabled", reencode: failClosed("IMAGE_RUNTIME=disabled") };
}
