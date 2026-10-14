/**
 * Per-tier clip limits for AI highlight reels: how big an upload may be and how
 * long the clip may run. The numbers come from `ai_limits` (superadmin AI
 * controls); this file only applies them.
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

/** Rounding slack so a 60.3s clip is not refused by a 60s limit. */
const DURATION_TOLERANCE_SECONDS = 1;

export type ClipLimits = {
  tier: AiTier;
  /** Effective cap: the tier's value, never above what Storage accepts. */
  maxUploadMb: number;
  maxVideoSeconds: number;
};

export function clipLimitsFor(tier: AiTier, limits: TierLimits): ClipLimits {
  return {
    tier,
    maxUploadMb: Math.min(limits.maxUploadMb, STORAGE_MAX_UPLOAD_MB),
    maxVideoSeconds: limits.maxVideoSeconds,
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

/* ------------------------- MP4 / QuickTime duration ------------------------ */

/** Reads bytes [start, end) of the file. */
export type ByteReader = (start: number, end: number) => Promise<Uint8Array>;

const MAX_BOXES_PER_LEVEL = 256;

type Box = { type: string; start: number; headerSize: number; end: number };

async function findBox(
  read: ByteReader,
  from: number,
  to: number,
  type: string,
): Promise<Box | null> {
  let offset = from;
  for (let i = 0; i < MAX_BOXES_PER_LEVEL && offset + 8 <= to; i++) {
    const head = await read(offset, Math.min(offset + 16, to));
    if (head.length < 8) return null;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const boxType = String.fromCharCode(head[4], head[5], head[6], head[7]);
    let headerSize = 8;
    if (size === 1) {
      if (head.length < 16) return null;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < headerSize || offset + size > to) return null;
    if (boxType === type) return { type: boxType, start: offset, headerSize, end: offset + size };
    offset += size;
  }
  return null;
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
