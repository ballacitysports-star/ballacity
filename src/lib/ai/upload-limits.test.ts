import { describe, expect, it } from "vitest";
import { DEFAULT_AI_LIMITS } from "./config";
import {
  STORAGE_MAX_UPLOAD_MB,
  claimedReelSeconds,
  clipLengthProblem,
  clipLimitsFor,
  mp4DurationSeconds,
  uploadSizeProblem,
  type ClipLimits,
} from "./upload-limits";

/* ------------------------------ MP4 builders ------------------------------ */

function box(type: string, body: Uint8Array, largesize = false): Uint8Array {
  const header = largesize ? 16 : 8;
  const out = new Uint8Array(header + body.length);
  const view = new DataView(out.buffer);
  if (largesize) {
    view.setUint32(0, 1);
    view.setBigUint64(8, BigInt(out.length));
  } else {
    view.setUint32(0, out.length);
  }
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, header);
  return out;
}

function mvhd(version: 0 | 1, timescale: number, duration: number | bigint): Uint8Array {
  const body = new Uint8Array(version === 1 ? 108 : 96);
  const view = new DataView(body.buffer);
  body[0] = version;
  if (version === 1) {
    view.setUint32(20, timescale);
    view.setBigUint64(24, BigInt(duration));
  } else {
    view.setUint32(12, timescale);
    view.setUint32(16, Number(duration));
  }
  return box("mvhd", body);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function reader(file: Uint8Array) {
  const reads: [number, number][] = [];
  const read = async (start: number, end: number) => {
    reads.push([start, end]);
    return file.slice(start, end);
  };
  return { read, reads };
}

const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\0\0isomiso2"));

describe("mp4DurationSeconds", () => {
  it("reads a version 0 movie header", async () => {
    const file = concat(ftyp, box("moov", mvhd(0, 1000, 75_500)));
    expect(await mp4DurationSeconds(reader(file).read, file.length)).toBeCloseTo(75.5);
  });

  it("reads a version 1 header inside a moov that sits after a large mdat", async () => {
    const mdat = box("mdat", new Uint8Array(200_000), true);
    const moov = box("moov", concat(box("udta", new Uint8Array(12)), mvhd(1, 600, 600n * 180n)));
    const file = concat(ftyp, mdat, moov);
    const { read, reads } = reader(file);
    expect(await mp4DurationSeconds(read, file.length)).toBe(180);
    // Box headers and the mvhd only: the media itself is never read.
    expect(reads.every(([s, e]) => e - s <= 32)).toBe(true);
  });

  it("returns null without a movie header or with an unknown duration", async () => {
    const noMoov = concat(ftyp, box("mdat", new Uint8Array(64)));
    expect(await mp4DurationSeconds(reader(noMoov).read, noMoov.length)).toBeNull();
    const fragmented = concat(ftyp, box("moov", mvhd(0, 1000, 0)));
    expect(await mp4DurationSeconds(reader(fragmented).read, fragmented.length)).toBeNull();
    const unknown = concat(ftyp, box("moov", mvhd(0, 1000, 0xffffffff)));
    expect(await mp4DurationSeconds(reader(unknown).read, unknown.length)).toBeNull();
  });

  it("returns null for truncated or garbage input instead of throwing", async () => {
    const full = concat(ftyp, box("moov", mvhd(0, 1000, 5000)));
    const truncated = full.slice(0, full.length - 40);
    expect(await mp4DurationSeconds(reader(truncated).read, truncated.length)).toBeNull();
    const junk = new Uint8Array(100).fill(0xff);
    expect(await mp4DurationSeconds(reader(junk).read, junk.length)).toBeNull();
  });
});

/* --------------------------------- limits --------------------------------- */

const limits: ClipLimits = { tier: "free", maxUploadMb: 100, maxVideoSeconds: 60 };
const MB = 1024 * 1024;

describe("clip limits", () => {
  it("never lets a tier exceed what Storage accepts", () => {
    const big = { ...DEFAULT_AI_LIMITS.gym, maxUploadMb: 500, maxVideoSeconds: 300 };
    expect(clipLimitsFor("gym", big)).toEqual({
      tier: "gym",
      maxUploadMb: STORAGE_MAX_UPLOAD_MB,
      maxVideoSeconds: 300,
    });
    expect(clipLimitsFor("free", { ...big, maxUploadMb: 100 }).maxUploadMb).toBe(100);
  });

  it("refuses an oversize upload with the numbers", () => {
    expect(uploadSizeProblem(100 * MB, limits)).toBeNull();
    expect(uploadSizeProblem(150 * MB, limits)).toBe(
      "This video is 150 MB. Your plan allows uploads up to 100 MB.",
    );
  });

  it("refuses an over-length clip, allowing rounding slack and unknown lengths", () => {
    expect(clipLengthProblem(60.4, limits)).toBeNull();
    expect(clipLengthProblem(null, limits)).toBeNull();
    expect(clipLengthProblem(135, limits)).toBe(
      "This clip is 2:15 long. Your plan allows clips up to 1:00.",
    );
  });

  it("takes the longest length any recorded value claims", () => {
    expect(claimedReelSeconds({})).toBeNull();
    expect(
      claimedReelSeconds({
        media_meta: { original: { durationSeconds: 40 }, processed: { durationSeconds: 41 } },
        frame_times: [1, 20, 95],
      }),
    ).toBe(95);
    expect(
      claimedReelSeconds({ media_meta: { original: { durationSeconds: "junk" } } }),
    ).toBeNull();
  });
});
