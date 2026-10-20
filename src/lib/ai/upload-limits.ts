/**
 * Per-tier limits for AI highlight reels: how big an upload may be, how long
 * and how large in pixels the clip may be, and how long one processing run may
 * take. The numbers come from `ai_limits` (superadmin AI controls); this file
 * only applies them.
 *
 * Shared by the browser (an early, friendly refusal) and the server (the real
 * gate, in finalizeVideoUpload and before the reel pipeline runs). Pure: no Node
 * or browser APIs.
 */

import { MAX_VIDEO_BYTES } from "@/lib/video-validation";
import type { AiTier, TierLimits } from "./config";

const MB = 1024 * 1024;

/** The `highlight-videos` bucket refuses anything bigger, whatever a tier says. */
export const STORAGE_MAX_UPLOAD_MB = MAX_VIDEO_BYTES / MB;

/**
 * The most one pipeline run may take, whatever a tier says. It sits under the
 * reel worker's stuck-run cutoff (`STUCK_AFTER_MS`, 10 minutes) so the worker
 * never starts a second run of a reel whose first one is still going.
 */
export const PIPELINE_RUN_CAP_SECONDS = 540;

/** Rounding slack so a 60.3s clip is not refused by a 60s limit. */
const DURATION_TOLERANCE_SECONDS = 1;

export type ClipLimits = {
  tier: AiTier;
  /** Effective cap: the tier's value, never above what Storage accepts. */
  maxUploadMb: number;
  maxVideoSeconds: number;
  /** Longest edge, in pixels, of the copy viewers are served. */
  maxResolution: number;
  /** Wall-clock budget for one run of the reel pipeline, never above the run cap. */
  maxProcessingSeconds: number;
};

export function clipLimitsFor(tier: AiTier, limits: TierLimits): ClipLimits {
  return {
    tier,
    maxUploadMb: Math.min(limits.maxUploadMb, STORAGE_MAX_UPLOAD_MB),
    maxVideoSeconds: limits.maxVideoSeconds,
    maxResolution: limits.maxResolution,
    maxProcessingSeconds: Math.min(limits.maxProcessingSeconds, PIPELINE_RUN_CAP_SECONDS),
  };
}

export function formatClipLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A user-facing refusal, or null when the file fits. */
export function uploadSizeProblem(bytes: number, limits: ClipLimits): string | null {
  if (bytes > limits.maxUploadMb * MB) {
    return `This video is ${Math.ceil(bytes / MB)} MB. Your plan allows uploads up to ${limits.maxUploadMb} MB.`;
  }
  return null;
}

/** A user-facing refusal, or null when the clip fits or its length is unknown. */
export function clipLengthProblem(seconds: number | null, limits: ClipLimits): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds > limits.maxVideoSeconds + DURATION_TOLERANCE_SECONDS) {
    return `This clip is ${formatClipLength(seconds)} long. Your plan allows clips up to ${formatClipLength(limits.maxVideoSeconds)}.`;
  }
  return null;
}

/** True when a clip's longer edge is over the plan's resolution. Unknown sizes pass. */
export function exceedsResolution(
  size: { width: number | null; height: number | null } | null,
  limits: ClipLimits,
): boolean {
  if (!size?.width || !size?.height) return false;
  return Math.max(size.width, size.height) > limits.maxResolution;
}

/** A user-facing refusal, or null when the clip fits or its size is unknown. */
export function resolutionProblem(
  size: { width: number | null; height: number | null } | null,
  limits: ClipLimits,
): string | null {
  if (!exceedsResolution(size, limits)) return null;
  return `This clip is ${size!.width}×${size!.height}. Your plan allows up to ${limits.maxResolution} pixels on the longer side.`;
}

/**
 * The longest length anything recorded for a reel claims: the uploader's probe
 * of the original and converted copies, and the last sampled frame. All of it is
 * client-supplied, so this is a backstop for rows that skipped the server check,
 * not the check itself.
 */
export function claimedReelSeconds(reel: {
  media_meta?: unknown;
  frame_times?: unknown;
}): number | null {
  const values: number[] = [];
  type Probe = { durationSeconds?: unknown } | null | undefined;
  const meta = (reel.media_meta ?? {}) as { original?: Probe; processed?: Probe };
  for (const part of [meta.original, meta.processed]) {
    const d = Number(part?.durationSeconds);
    if (Number.isFinite(d) && d > 0) values.push(d);
  }
  if (Array.isArray(reel.frame_times)) {
    for (const t of reel.frame_times) {
      const n = Number(t);
      if (Number.isFinite(n) && n > 0) values.push(n);
    }
  }
  return values.length ? Math.max(...values) : null;
}

/* ----------------------- MP4 / QuickTime movie header ---------------------- */

/** Reads bytes [start, end) of the file. */
export type ByteReader = (start: number, end: number) => Promise<Uint8Array>;

const MAX_BOXES_PER_LEVEL = 256;

type Box = { type: string; start: number; headerSize: number; end: number };

/** Every box of `type` directly inside [from, to); stops at the first malformed one. */
async function findBoxes(
  read: ByteReader,
  from: number,
  to: number,
  type: string,
  max = MAX_BOXES_PER_LEVEL,
): Promise<Box[]> {
  const found: Box[] = [];
  let offset = from;
  for (let i = 0; i < MAX_BOXES_PER_LEVEL && offset + 8 <= to && found.length < max; i++) {
    const head = await read(offset, Math.min(offset + 16, to));
    if (head.length < 8) break;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const boxType = String.fromCharCode(head[4], head[5], head[6], head[7]);
    let headerSize = 8;
    if (size === 1) {
      if (head.length < 16) break;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < headerSize || offset + size > to) break;
    if (boxType === type)
      found.push({ type: boxType, start: offset, headerSize, end: offset + size });
    offset += size;
  }
  return found;
}

async function findBox(read: ByteReader, from: number, to: number, type: string) {
  return (await findBoxes(read, from, to, type, 1))[0] ?? null;
}

/**
 * Clip length from the movie header (`moov` → `mvhd`) of an MP4 or QuickTime
 * file, reading only box headers and the mvhd itself. Null when the file has no
 * readable header or records no duration (e.g. a fragmented MP4).
 */
export async function mp4DurationSeconds(
  read: ByteReader,
  fileSize: number,
): Promise<number | null> {
  try {
    const moov = await findBox(read, 0, fileSize, "moov");
    if (!moov) return null;
    const mvhd = await findBox(read, moov.start + moov.headerSize, moov.end, "mvhd");
    if (!mvhd) return null;
    const body = await read(
      mvhd.start + mvhd.headerSize,
      Math.min(mvhd.end, mvhd.start + mvhd.headerSize + 32),
    );
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const version = body[0];
    let timescale: number;
    let duration: number;
    if (version === 1) {
      if (body.length < 32) return null;
      timescale = view.getUint32(20);
      const raw = view.getBigUint64(24);
      if (raw === 0xffffffffffffffffn) return null;
      duration = Number(raw);
    } else {
      if (body.length < 20) return null;
      timescale = view.getUint32(12);
      duration = view.getUint32(16);
      if (duration === 0xffffffff) return null;
    }
    if (!timescale || !duration) return null;
    return duration / timescale;
  } catch {
    return null;
  }
}

/**
 * Picture size from the track headers (`moov` → `trak` → `tkhd`) of an MP4 or
 * QuickTime file: the largest track with a picture. Null when none is readable.
 */
export async function mp4VideoSize(
  read: ByteReader,
  fileSize: number,
): Promise<{ width: number; height: number } | null> {
  try {
    const moov = await findBox(read, 0, fileSize, "moov");
    if (!moov) return null;
    let best: { width: number; height: number } | null = null;
    for (const trak of await findBoxes(read, moov.start + moov.headerSize, moov.end, "trak")) {
      const tkhd = await findBox(read, trak.start + trak.headerSize, trak.end, "tkhd");
      if (!tkhd) continue;
      const bodyStart = tkhd.start + tkhd.headerSize;
      const body = await read(bodyStart, Math.min(tkhd.end, bodyStart + 96));
      // Width and height are 16.16 fixed point after the version-dependent fields.
      const at = body[0] === 1 ? 88 : 76;
      if (body.length < at + 8) continue;
      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const width = view.getUint32(at) >>> 16;
      const height = view.getUint32(at + 4) >>> 16;
      if (!width || !height) continue;
      if (!best || width * height > best.width * best.height) best = { width, height };
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * The codec of every picture track (`moov` → `trak` → `mdia` → `hdlr` "vide",
 * then `minf` → `stbl` → `stsd`'s first sample entry), e.g. `avc1` or `hvc1`.
 * Null when the file has no readable movie header. Walks box headers only, so a
 * header written after the media (as phone cameras do) costs a few small reads.
 */
export async function mp4VideoCodecs(read: ByteReader, fileSize: number): Promise<string[] | null> {
  try {
    const moov = await findBox(read, 0, fileSize, "moov");
    if (!moov) return null;
    const inside = (b: Box, type: string) => findBox(read, b.start + b.headerSize, b.end, type);
    const codecs: string[] = [];
    for (const trak of await findBoxes(read, moov.start + moov.headerSize, moov.end, "trak")) {
      const mdia = await inside(trak, "mdia");
      const hdlr = mdia && (await inside(mdia, "hdlr"));
      if (!mdia || !hdlr) continue;
      // Version and flags, pre_defined, then the handler type.
      const handler = await read(
        hdlr.start + hdlr.headerSize + 8,
        hdlr.start + hdlr.headerSize + 12,
      );
      if (String.fromCharCode(...handler) !== "vide") continue;
      const minf = await inside(mdia, "minf");
      const stbl = minf && (await inside(minf, "stbl"));
      const stsd = stbl && (await inside(stbl, "stsd"));
      if (!stsd) continue;
      // Version and flags, entry count, then the first sample entry's size and type.
      const entry = await read(stsd.start + stsd.headerSize + 8, stsd.start + stsd.headerSize + 16);
      if (entry.length < 8) continue;
      codecs.push(String.fromCharCode(entry[4], entry[5], entry[6], entry[7]));
    }
    return codecs;
  } catch {
    return null;
  }
}
