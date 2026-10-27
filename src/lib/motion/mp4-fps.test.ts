import { describe, expect, it } from "vitest";
import { fpsFromMoov, readVideoFps, tidyFps } from "./mp4-fps";

// --- a tiny MP4 writer, just enough to build the header structure the parser reads ---

const enc = new TextEncoder();
const u32 = (n: number) =>
  new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};
const box = (type: string, ...payload: Uint8Array[]) => {
  const body = cat(...payload);
  return cat(u32(8 + body.length), enc.encode(type), body);
};
const box64 = (type: string, ...payload: Uint8Array[]) => {
  const body = cat(...payload);
  return cat(u32(1), enc.encode(type), u32(0), u32(16 + body.length), body);
};

function mdhd(timescale: number, version = 0) {
  return version === 0
    ? box("mdhd", u32(0), u32(0), u32(0), u32(timescale), u32(0))
    : box("mdhd", u32(0x01000000), u32(0), u32(0), u32(0), u32(0), u32(timescale), u32(0), u32(0));
}
const hdlr = (kind: string) =>
  box("hdlr", u32(0), u32(0), enc.encode(kind), u32(0), u32(0), u32(0));
const stts = (entries: [number, number][]) =>
  box("stts", u32(0), u32(entries.length), ...entries.flatMap(([c, d]) => [u32(c), u32(d)]));
const trak = (kind: string, timescale: number, entries: [number, number][], version = 0) =>
  box(
    "trak",
    box("mdia", mdhd(timescale, version), hdlr(kind), box("minf", box("stbl", stts(entries)))),
  );
const moovOf = (...traks: Uint8Array[]) => box("moov", ...traks);
const payload = (moov: Uint8Array) => moov.slice(8).buffer as ArrayBuffer;
const file = (...parts: Uint8Array[]) => new Blob([cat(...parts)]);

describe("fpsFromMoov", () => {
  it("reads 30 fps", () => {
    const m = moovOf(trak("vide", 30000, [[300, 1000]]));
    expect(fpsFromMoov(payload(m))).toBeCloseTo(30, 5);
  });

  it("reads 240 fps slow-motion", () => {
    const m = moovOf(trak("vide", 24000, [[720, 100]]));
    expect(fpsFromMoov(payload(m))).toBeCloseTo(240, 5);
  });

  it("reads NTSC 29.97", () => {
    const m = moovOf(trak("vide", 30000, [[300, 1001]]));
    expect(fpsFromMoov(payload(m))).toBeCloseTo(29.97, 2);
  });

  it("averages a clip that changes rate partway (variable frame rate)", () => {
    // 1s at 60fps then 1s at 30fps -> 90 frames in 2s = 45 fps average
    const m = moovOf(
      trak("vide", 600, [
        [60, 10],
        [30, 20],
      ]),
    );
    expect(fpsFromMoov(payload(m))).toBeCloseTo(45, 5);
  });

  it("skips an audio track that comes first", () => {
    const m = moovOf(trak("soun", 44100, [[1000, 1024]]), trak("vide", 24000, [[480, 100]]));
    expect(fpsFromMoov(payload(m))).toBeCloseTo(240, 5);
  });

  it("handles the 64-bit header version of mdhd", () => {
    const m = moovOf(trak("vide", 12000, [[120, 100]], 1));
    expect(fpsFromMoov(payload(m))).toBeCloseTo(120, 5);
  });

  it("returns null with no video track, or no frames", () => {
    expect(fpsFromMoov(payload(moovOf(trak("soun", 44100, [[10, 1024]]))))).toBeNull();
    expect(fpsFromMoov(payload(moovOf(trak("vide", 30000, []))))).toBeNull();
    expect(fpsFromMoov(payload(moovOf(trak("vide", 30000, [[1, 1000]]))))).toBeNull();
    expect(fpsFromMoov(new ArrayBuffer(0))).toBeNull();
  });

  it("rejects a rate nobody films at", () => {
    expect(fpsFromMoov(payload(moovOf(trak("vide", 1000, [[2, 1000]]))))).toBeNull(); // 1 fps
    expect(fpsFromMoov(payload(moovOf(trak("vide", 1000, [[1000, 1]]))))).toBeNull(); // 1000 fps
  });

  it("never reads past a damaged header", () => {
    const m = moovOf(trak("vide", 30000, [[300, 1000]]));
    const cut = payload(m).slice(0, 40);
    expect(() => fpsFromMoov(cut)).not.toThrow();
    expect(fpsFromMoov(cut)).toBeNull();
    // A box that claims to be larger than the file.
    const lying = cat(u32(99999), enc.encode("trak"), u32(0)).buffer as ArrayBuffer;
    expect(fpsFromMoov(lying)).toBeNull();
  });
});

describe("tidyFps", () => {
  it("snaps near-standard rates and keeps unusual ones", () => {
    expect(tidyFps(29.97)).toBe(30);
    expect(tidyFps(239.76)).toBe(240);
    expect(tidyFps(59.94)).toBe(60);
    expect(tidyFps(75.123)).toBe(75.12);
  });
});

describe("readVideoFps", () => {
  const ftyp = box("ftyp", enc.encode("isom"), u32(0), enc.encode("isom"));
  const mdat = (n: number) => box("mdat", new Uint8Array(n));

  it("reads a file whose header comes first", async () => {
    const f = file(ftyp, moovOf(trak("vide", 24000, [[720, 100]])), mdat(2000));
    expect(await readVideoFps(f)).toBe(240);
  });

  it("finds a header stored AFTER the video data, as phones do", async () => {
    const f = file(ftyp, mdat(500_000), moovOf(trak("vide", 30000, [[300, 1001]])));
    expect(await readVideoFps(f)).toBe(30);
  });

  it("copes with a 64-bit box size on the video data", async () => {
    const f = file(
      ftyp,
      box64("mdat", new Uint8Array(1000)),
      moovOf(trak("vide", 12000, [[120, 100]])),
    );
    expect(await readVideoFps(f)).toBe(120);
  });

  it("returns null for something that is not an MP4", async () => {
    expect(await readVideoFps(new Blob([enc.encode("\x1aE\xdf\xa3 this is webm")]))).toBeNull();
    expect(await readVideoFps(new Blob([]))).toBeNull();
    expect(await readVideoFps(new Blob([new Uint8Array(4)]))).toBeNull();
  });

  it("returns null when the header is missing or oversized", async () => {
    expect(await readVideoFps(file(ftyp, mdat(100)))).toBeNull();
    const huge = cat(u32(1), enc.encode("moov"), u32(0x00ffffff), u32(0), new Uint8Array(8));
    expect(await readVideoFps(file(ftyp, huge))).toBeNull();
  });

  it("does not throw on garbage", async () => {
    const noise = new Uint8Array(4096).map((_, i) => (i * 131 + 7) & 255);
    await expect(readVideoFps(new Blob([noise]))).resolves.toBeNull();
  });
});
