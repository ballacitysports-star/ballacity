/**
 * The one result contract every image runtime must meet (audit F09). In-process sharp (`reencodeImage`), the Node sharp
 * service (`services/image-processor`, over `processor-protocol.ts`) and the Cloudflare Images PoC all return a
 * `ReencodeResult`; this module is the single definition of what a valid one is, and the selector checks every runtime's
 * output against it before promotion sees it.
 *
 * Version 2 (this one): `transparency` says what the published pixels hold, and `scanRenditions` must carry exactly the
 * renditions that transparency requires, each a JPEG data URL of at most SCAN_RENDITION_MAX_SIDE per side:
 *   none     no pixel is transparent                    → no rendition
 *   binary   some alpha < 255, none strictly between     → flattened on white, flattened on black
 *   partial  some alpha strictly between 0 and 255       → white, black, and the colour with alpha dropped
 * Version 1 (the #284 PoC) carried a single optional `alphaRemovedScanTarget`. It lost the white and black renditions, so a
 * picture drawn in the alpha channel alone was never scanned as a viewer sees it. A v1 answer is refused (fail closed).
 *
 * Limit: the check is on what the runtime declares. A runtime that understates the transparency of its own output ("none"
 * with no renditions, for a picture that has transparent pixels) is consistent and passes; catching it would mean decoding
 * the output in the Worker (up to 30 MP). That is the residual already recorded for a compromised service, which could
 * equally return different pixels (docs/privacy/image-runtime-evaluation.md, "Residual risks").
 */
import {
  SCAN_RENDITION_MAX_SIDE,
  type ImageTransparency,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import { readImageDimensions, sniffImageMime } from "@/lib/image-validation";

export const REENCODE_CONTRACT_VERSION = 2;

export const IMAGE_TRANSPARENCIES: readonly ImageTransparency[] = ["none", "binary", "partial"];

/** How many scan renditions a result with this transparency must carry. */
export function requiredScanRenditions(transparency: ImageTransparency): number {
  return transparency === "partial" ? 3 : transparency === "binary" ? 2 : 0;
}

const DATA_URL_PREFIX = "data:image/jpeg;base64,";
/** A rendition is a JPEG of at most 2048 px per side; anything near this size is not one. */
export const MAX_SCAN_RENDITION_CHARS = 16 * 1024 * 1024;

function decodeBase64(s: string): Uint8Array | null {
  if (s.length === 0 || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Why `rendition` is not a valid scan rendition, or null. */
export function scanRenditionProblem(rendition: unknown): string | null {
  if (typeof rendition !== "string" || !rendition.startsWith(DATA_URL_PREFIX))
    return "scan rendition is not a JPEG data URL";
  if (rendition.length > MAX_SCAN_RENDITION_CHARS) return "scan rendition too large";
  const bytes = decodeBase64(rendition.slice(DATA_URL_PREFIX.length));
  if (!bytes || sniffImageMime(bytes) !== "image/jpeg") return "scan rendition is not a JPEG";
  const dims = readImageDimensions(bytes);
  if (
    !dims ||
    dims.width < 1 ||
    dims.height < 1 ||
    dims.width > SCAN_RENDITION_MAX_SIDE ||
    dims.height > SCAN_RENDITION_MAX_SIDE
  )
    return "scan rendition size";
  return null;
}

/**
 * Why `result` breaks the contract, or null. Checks the shape (a runtime may be remote or out of date) and that every
 * rendition its transparency requires is present: a missing rendition means part of what a viewer can see is never scanned.
 */
export function reencodeResultProblem(result: unknown): string | null {
  if (!result || typeof result !== "object") return "no result";
  const r = result as Partial<ReencodeResult> & Record<string, unknown>;
  if ("alphaRemovedScanTarget" in r) return "contract v1 result (alphaRemovedScanTarget)";
  if (!(r.bytes instanceof Uint8Array) || r.bytes.byteLength === 0) return "no bytes";
  if (typeof r.hasAlpha !== "boolean") return "hasAlpha";
  if (!IMAGE_TRANSPARENCIES.includes(r.transparency as ImageTransparency)) return "transparency";
  const transparency = r.transparency as ImageTransparency;
  if (transparency !== "none" && (!r.hasAlpha || r.mime === "image/jpeg"))
    return "transparency without an alpha channel";
  if (!Array.isArray(r.scanRenditions)) return "scanRenditions";
  const want = requiredScanRenditions(transparency);
  if (r.scanRenditions.length !== want)
    return `scanRenditions: ${transparency} transparency needs ${want}, got ${r.scanRenditions.length}`;
  for (const rendition of r.scanRenditions) {
    const problem = scanRenditionProblem(rendition);
    if (problem) return problem;
  }
  return null;
}
