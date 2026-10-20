import { describe, expect, it } from "vitest";
import { DEFAULT_AI_LIMITS } from "./config";
import {
  PIPELINE_RUN_CAP_SECONDS,
  STORAGE_MAX_UPLOAD_MB,
  claimedReelSeconds,
  clipLengthProblem,
  clipLimitsFor,
  exceedsResolution,
  mp4DurationSeconds,
  mp4VideoCodecs,
  mp4VideoSize,
  resolutionProblem,
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

const limits: ClipLimits = {
  tier: "free",
  maxUploadMb: 100,
  maxVideoSeconds: 60,
  maxResolution: 1920,
  maxProcessingSeconds: 300,
};
const MB = 1024 * 1024;

describe("clip limits", () => {
  it("never lets a tier exceed what Storage accepts", () => {
    const big = { ...DEFAULT_AI_LIMITS.gym, maxUploadMb: 500, maxVideoSeconds: 300 };
    expect(clipLimitsFor("gym", big)).toMatchObject({
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

function tkhd(version: 0 | 1, width: number, height: number): Uint8Array {
  const body = new Uint8Array(version === 1 ? 96 : 84);
  const view = new DataView(body.buffer);
  body[0] = version;
  const at = version === 1 ? 88 : 76;
  view.setUint32(at, width * 65536);
  view.setUint32(at + 4, height * 65536);
  return box("tkhd", body);
}

const trak = (header: Uint8Array) => box("trak", concat(header, box("mdia", new Uint8Array(8))));

describe("mp4VideoSize", () => {
  it("reads the picture track and ignores an audio track's empty size", async () => {
    const moov = box(
      "moov",
      concat(mvhd(0, 1000, 1000), trak(tkhd(0, 0, 0)), trak(tkhd(0, 3840, 2160))),
    );
    const file = concat(ftyp, moov);
    expect(await mp4VideoSize(reader(file).read, file.length)).toEqual({
      width: 3840,
      height: 2160,
    });
  });

  it("reads a version 1 track header", async () => {
    const file = concat(ftyp, box("moov", trak(tkhd(1, 1080, 1920))));
    expect(await mp4VideoSize(reader(file).read, file.length)).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it("returns null with no picture track", async () => {
    const file = concat(ftyp, box("moov", mvhd(0, 1000, 1000)));
    expect(await mp4VideoSize(reader(file).read, file.length)).toBeNull();
  });
});

describe("resolution and processing limits", () => {
  it("compares the longer edge, so portrait and landscape are treated alike", () => {
    expect(exceedsResolution({ width: 1920, height: 1080 }, limits)).toBe(false);
    expect(exceedsResolution({ width: 1080, height: 1920 }, limits)).toBe(false);
    expect(exceedsResolution({ width: 2160, height: 3840 }, limits)).toBe(true);
    expect(exceedsResolution({ width: null, height: null }, limits)).toBe(false);
    expect(resolutionProblem({ width: 3840, height: 2160 }, limits)).toBe(
      "This clip is 3840×2160. Your plan allows up to 1920 pixels on the longer side.",
    );
  });

  it("caps a run under the worker's stuck-run cutoff", async () => {
    const { STUCK_AFTER_MS } = await import("@/lib/reels-pipeline.server");
    expect(PIPELINE_RUN_CAP_SECONDS * 1000).toBeLessThan(STUCK_AFTER_MS);
    const slow = { ...DEFAULT_AI_LIMITS.free, maxProcessingSeconds: 3600 };
    expect(clipLimitsFor("free", slow).maxProcessingSeconds).toBe(PIPELINE_RUN_CAP_SECONDS);
    expect(clipLimitsFor("free", { ...slow, maxProcessingSeconds: 120 }).maxProcessingSeconds).toBe(
      120,
    );
  });
});

/** A track with a handler and a first sample entry, as cameras write them. */
function codecTrak(handler: string, entry: string): Uint8Array {
  const hdlr = box(
    "hdlr",
    concat(new Uint8Array(8), new TextEncoder().encode(handler), new Uint8Array(12)),
  );
  const stsd = box(
    "stsd",
    concat(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), box(entry, new Uint8Array(78))),
  );
  const minf = box("minf", box("stbl", stsd));
  return box("trak", concat(tkhd(0, 0, 0), box("mdia", concat(hdlr, minf))));
}

describe("mp4VideoCodecs", () => {
  it("reads the picture track's codec from a header written after the media", async () => {
    const mdat = box("mdat", new Uint8Array(600_000));
    const moov = box(
      "moov",
      concat(mvhd(0, 600, 6000), codecTrak("soun", "mp4a"), codecTrak("vide", "avc1")),
    );
    const file = concat(box("ftyp", new TextEncoder().encode("qt  \0\0\0\0qt  ")), mdat, moov);
    const { read, reads } = reader(file);
    expect(await mp4VideoCodecs(read, file.length)).toEqual(["avc1"]);
    expect(reads.every(([s, e]) => e - s <= 16)).toBe(true);
  });

  it("reports HEVC, and nothing for a header with no picture track", async () => {
    const hevc = concat(ftyp, box("moov", codecTrak("vide", "hvc1")));
    expect(await mp4VideoCodecs(reader(hevc).read, hevc.length)).toEqual(["hvc1"]);
    const audioOnly = concat(ftyp, box("moov", codecTrak("soun", "mp4a")));
    expect(await mp4VideoCodecs(reader(audioOnly).read, audioOnly.length)).toEqual([]);
  });

  it("returns null for a file that is not an MP4", async () => {
    const riff = new TextEncoder().encode("RIFF\xff\xff\xff\xffAVI LIST");
    expect(await mp4VideoCodecs(reader(riff).read, riff.length)).toBeNull();
  });
});
