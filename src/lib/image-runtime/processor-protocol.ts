/**
 * Wire format between the Worker client (node-service-client.ts) and the Node image processor (services/image-processor).
 *
 *   POST /v1/reencode   content-type: application/octet-stream   body: the image bytes, nothing else (no names, ids or paths)
 *   200  content-type: application/vnd.ballacity.reencode.v2     body: u32 BE metadata length | metadata JSON | re-encoded bytes
 *        The metadata is the ReencodeResult without its bytes, plus `contractVersion: 2` (src/lib/image-runtime/reencode-contract.ts).
 *        A v1 answer (content type ...v1, `alphaRemovedScanTarget`) is refused: the two sides must be deployed at the same version.
 *   422  content-type: application/json                          body: {"code": ReencodeErrorCode}
 *   401 / 404 / 405 / 413 / 415 / 503                             body: {"code": ...} (503 is always "unavailable")
 * Every response to an authenticated request carries x-bc-signature over (request nonce, status, body SHA-256).
 */
import type { ReencodeErrorCode, ReencodeResult } from "@/lib/image-reencode.server";
import { REENCODE_CONTRACT_VERSION } from "@/lib/image-runtime/reencode-contract";

export const PROCESSOR_PATH = "/v1/reencode";
export const RESULT_CONTENT_TYPE = `application/vnd.ballacity.reencode.v${REENCODE_CONTRACT_VERSION}`;
export const REENCODE_CODES: readonly ReencodeErrorCode[] = [
  "unsupported",
  "animated",
  "too_large",
  "unreadable",
  "unavailable",
];

export type ResultMeta = Omit<ReencodeResult, "bytes">;

export function encodeResult(result: ReencodeResult): Uint8Array {
  const { bytes, ...meta } = result;
  const json = new TextEncoder().encode(
    JSON.stringify({ ...meta, contractVersion: REENCODE_CONTRACT_VERSION }),
  );
  const out = new Uint8Array(4 + json.length + bytes.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(bytes, 4 + json.length);
  return out;
}

export function decodeResult(body: Uint8Array): { meta: ResultMeta; bytes: Uint8Array } | null {
  if (body.length < 4) return null;
  const n = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
  if (n > body.length - 4 || n > 4 * 1024 * 1024) return null;
  try {
    const meta = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(4, 4 + n)),
    );
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
    if (meta.contractVersion !== REENCODE_CONTRACT_VERSION) return null;
    delete meta.contractVersion;
    return { meta: meta as ResultMeta, bytes: body.slice(4 + n) };
  } catch {
    return null;
  }
}
