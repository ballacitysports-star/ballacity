/**
 * PROOF OF CONCEPT, NOT WIRED INTO THE APP. Worker-side client for the Node sharp image processor (services/image-processor).
 * Same contract as reencodeImage: resolves a ReencodeResult or throws ImageReencodeError.
 *
 * Fail closed: a network error, a timeout (AbortController), a non-200/422 status, a missing or wrong response signature, a
 * malformed body, or an output that does not pass the Worker's own checks all throw. Transport and service problems are
 * "unavailable" (promotion holds the upload: nothing published, retryable); a 422 carries the service's refusal code; an output
 * that fails verification is "unreadable". The Worker sends only the image bytes: no user id, path, name or storage credential.
 */
import { inspectImageMetadata } from "@/lib/image-metadata";
import { ImageReencodeError, type ReencodeResult } from "@/lib/image-reencode.server";
import {
  MAX_IMAGE_BYTES,
  readImageDimensions,
  sniffImageMime,
  validateImageMeta,
} from "@/lib/image-validation";
import {
  SIGNATURE_HEADERS,
  canonicalResponse,
  hmacHex,
  safeEqualHex,
  sha256Hex,
  signRequest,
} from "@/lib/image-runtime/hmac";
import {
  PROCESSOR_PATH,
  REENCODE_CODES,
  RESULT_CONTENT_TYPE,
  decodeResult,
} from "@/lib/image-runtime/processor-protocol";

export type ImageProcessorClientConfig = {
  /** Base URL of the service, e.g. https://image-processor.internal.example. HTTPS required except for loopback (tests). */
  url: string;
  /** The shared HMAC secret (at least 32 bytes). */
  secret: string;
  /** Whole-call timeout. Defaults to 25 s (the service's own timeout is 20 s). */
  timeoutMs?: number;
  /** Test seam. */
  fetch?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 25_000;
/** Largest response accepted: the image (at most MAX_IMAGE_BYTES) plus metadata and the scan rendition data URL. */
const MAX_RESPONSE_BYTES = MAX_IMAGE_BYTES + 8 * 1024 * 1024;

export function isAllowedProcessorUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.username || u.password || u.search || u.hash) return false;
    if (u.protocol === "https:") return true;
    return (
      u.protocol === "http:" &&
      (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

const unavailable = (detail: string) => new ImageReencodeError("unavailable", detail);

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw unavailable("response too large");
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

export function createImageProcessorReencoder(config: ImageProcessorClientConfig) {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async function reencodeViaImageProcessor(input: Uint8Array): Promise<ReencodeResult> {
    const mime = sniffImageMime(input);
    if (!mime) throw new ImageReencodeError("unsupported");
    if (!isAllowedProcessorUrl(config.url)) throw unavailable("image processor URL not allowed");
    let headers: Record<string, string>;
    try {
      headers = await signRequest(config.secret, {
        method: "POST",
        path: PROCESSOR_PATH,
        body: input,
      });
    } catch (e) {
      throw unavailable(String((e as Error)?.message ?? e));
    }
    const nonce = headers[SIGNATURE_HEADERS.nonce];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let body: Uint8Array;
    let signature: string | null;
    let contentType: string;
    try {
      const res = await doFetch(new URL(PROCESSOR_PATH, config.url).toString(), {
        method: "POST",
        headers: { ...headers, "content-type": "application/octet-stream" },
        body: input as BodyInit,
        signal: controller.signal,
        redirect: "error",
      });
      status = res.status;
      signature = res.headers.get(SIGNATURE_HEADERS.signature);
      contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      body = await readCapped(res, MAX_RESPONSE_BYTES);
    } catch (e) {
      if (e instanceof ImageReencodeError) throw e;
      throw unavailable(`image processor: ${String((e as Error)?.message ?? e)}`);
    } finally {
      clearTimeout(timer);
    }

    if (status !== 200 && status !== 422) throw unavailable(`image processor status ${status}`);
    const expected = await hmacHex(
      config.secret,
      canonicalResponse({ nonce, status, bodySha256: await sha256Hex(body) }),
    );
    if (!signature || !safeEqualHex(expected, signature)) throw unavailable("response signature");

    if (status === 422) {
      let code: unknown;
      try {
        code = JSON.parse(new TextDecoder().decode(body))?.code;
      } catch {
        code = null;
      }
      if (typeof code === "string" && (REENCODE_CODES as string[]).includes(code))
        throw new ImageReencodeError(
          code as (typeof REENCODE_CODES)[number],
          "image processor refused",
        );
      throw unavailable("image processor refusal without a known code");
    }

    if (contentType !== RESULT_CONTENT_TYPE) throw unavailable("response content type");
    const decoded = decodeResult(body);
    if (!decoded) throw unavailable("response body");
    const { meta, bytes } = decoded;

    // Verify independently of the service: same type, the size it claims, nothing the byte inspector would strip.
    const dims = readImageDimensions(bytes);
    const report = inspectImageMetadata(bytes);
    const rendition = meta.alphaRemovedScanTarget;
    const problem =
      sniffImageMime(bytes) !== mime || meta.mime !== mime
        ? "output type changed"
        : !dims || dims.width !== meta.width || dims.height !== meta.height
          ? "output size does not match"
          : report.animated ||
              report.hasExif ||
              report.hasGps ||
              report.hasXmp ||
              report.hasOther ||
              report.orientation
            ? "output carries metadata"
            : rendition !== null &&
                (typeof rendition !== "string" || !rendition.startsWith("data:image/jpeg;base64,"))
              ? "scan rendition"
              : validateImageMeta({ mime, bytes: bytes.byteLength, dimensions: dims });
    if (problem) throw new ImageReencodeError("unreadable", problem);
    return { ...meta, bytes, mime, width: dims!.width, height: dims!.height };
  };
}
