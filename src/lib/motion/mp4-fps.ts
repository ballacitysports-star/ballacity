/**
 * Reads a clip's real frame rate from the file itself.
 *
 * A browser's video element will not say how many frames a second a clip has,
 * and guessing 30 would make every step wrong on a 120 or 240 fps slow-motion
 * clip, which is exactly the footage coaches review. MP4 and MOV files (what
 * iPhones and Android phones record) carry a table of how long each frame lasts
 * in their header, so the true rate is a division away. Nothing is uploaded; the
 * file is read in place, a few bytes at a time, and only its header is parsed.
 *
 * Anything this cannot read (WebM, a fragmented file, a damaged header) returns
 * null and the caller falls back to a rate the member can set by hand.
 *
 * Client-safe.
 */

import { snapFps } from "./frames";

/** Large enough for any phone clip's header, small enough to never matter. */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;

type Box = { type: string; dataStart: number; end: number };

function fourcc(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

function* childBoxes(view: DataView, from: number, to: number): Generator<Box> {
  let pos = from;
  while (pos + 8 <= to) {
    let size = view.getUint32(pos);
    const type = fourcc(view, pos + 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > to) return;
      size = view.getUint32(pos + 8) * 2 ** 32 + view.getUint32(pos + 12);
      header = 16;
    } else if (size === 0) {
      size = to - pos;
    }
    if (size < header || pos + size > to) return;
    yield { type, dataStart: pos + header, end: pos + size };
    pos += size;
  }
}

function find(
  view: DataView,
  parent: { dataStart: number; end: number },
  type: string,
): Box | null {
  for (const b of childBoxes(view, parent.dataStart, parent.end)) if (b.type === type) return b;
  return null;
}

/** Average frames per second of the first video track in a `moov` box, or null. */
export function fpsFromMoov(buffer: ArrayBuffer): number | null {
  const view = new DataView(buffer);
  const moov = { dataStart: 0, end: buffer.byteLength };
  for (const trak of childBoxes(view, moov.dataStart, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = find(view, trak, "mdia");
    if (!mdia) continue;
    const hdlr = find(view, mdia, "hdlr");
    // version+flags (4), pre_defined (4), then the handler type.
    if (!hdlr || hdlr.dataStart + 12 > hdlr.end || fourcc(view, hdlr.dataStart + 8) !== "vide")
      continue;

    const mdhd = find(view, mdia, "mdhd");
    if (!mdhd || mdhd.dataStart + 4 > mdhd.end) continue;
    const version = view.getUint8(mdhd.dataStart);
    const tsAt = mdhd.dataStart + (version === 1 ? 20 : 12);
    if (tsAt + 4 > mdhd.end) continue;
    const timescale = view.getUint32(tsAt);
    if (!(timescale > 0)) continue;

    const minf = find(view, mdia, "minf");
    const stbl = minf && find(view, minf, "stbl");
    const stts = stbl && find(view, stbl, "stts");
    if (!stts || stts.dataStart + 8 > stts.end) continue;

    const entries = view.getUint32(stts.dataStart + 4);
    let samples = 0;
    let ticks = 0;
    for (let i = 0; i < entries; i += 1) {
      const at = stts.dataStart + 8 + i * 8;
      if (at + 8 > stts.end) break;
      const count = view.getUint32(at);
      const delta = view.getUint32(at + 4);
      samples += count;
      ticks += count * delta;
    }
    if (samples < 2 || !(ticks > 0)) continue;
    const fps = samples / (ticks / timescale);
    if (Number.isFinite(fps) && fps >= 5 && fps <= 480) return fps;
  }
  return null;
}

/** A rate to use: snapped to a common one when close, otherwise the measured value to 2 places. */
export function tidyFps(raw: number): number {
  return snapFps(raw) ?? Math.round(raw * 100) / 100;
}

/**
 * The frame rate of an MP4 / MOV file, read from its header, or null if the file is
 * another format or the header cannot be read.
 */
export async function readVideoFps(file: Blob): Promise<number | null> {
  try {
    let pos = 0;
    for (let i = 0; i < MAX_TOP_LEVEL_BOXES && pos + 8 <= file.size; i += 1) {
      const head = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      if (head.byteLength < 8) return null;
      let size = head.getUint32(0);
      const type = fourcc(head, 4);
      let header = 8;
      if (size === 1) {
        if (head.byteLength < 16) return null;
        size = head.getUint32(8) * 2 ** 32 + head.getUint32(12);
        header = 16;
      } else if (size === 0) {
        size = file.size - pos;
      }
      if (!(size >= header)) return null;
      if (i === 0 && type !== "ftyp" && type !== "moov" && type !== "mdat" && type !== "free") {
        return null; // not an ISO media file
      }
      if (type === "moov") {
        if (size - header > MAX_MOOV_BYTES) return null;
        const payload = await file.slice(pos + header, pos + size).arrayBuffer();
        const fps = fpsFromMoov(payload);
        return fps == null ? null : tidyFps(fps);
      }
      pos += size;
    }
    return null;
  } catch {
    return null;
  }
}
