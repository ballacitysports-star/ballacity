import { describe, expect, it } from "vitest";
import { inspectImageMetadata, stripImageMetadata } from "./image-metadata";
import { readImageDimensions } from "./image-validation";

// Review round 4: kept segments/chunks are copied at their spec length (extra bytes cut, reported as hasOther) or refused, and a
// file with no image data is refused. Hidden bytes are marked "HIDE" so a test can show they did not survive.
const enc = new TextEncoder();
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) {
    o.set(x, k);
    k += x.length;
  }
  return o;
};
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const HIDE = enc.encode("HIDE-PAYLOAD");
const le32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
const be32 = (n: number) => Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);

// ---- JPEG
const seg = (m: number, payload: Uint8Array) =>
  cat(Uint8Array.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
const SOI = Uint8Array.from([0xff, 0xd8]);
const EOI = Uint8Array.from([0xff, 0xd9]);
const SOF_P = Uint8Array.from([8, 0, 80, 0, 100, 1, 1, 0x11, 0]); // 80 x 100, one component
const SOS_P = Uint8Array.from([1, 1, 0, 0, 63, 0]);
const DATA = Uint8Array.from([1, 2, 3]);
const jpeg = (o: { pre?: Uint8Array[]; sof?: Uint8Array; sos?: Uint8Array } = {}) =>
  cat(SOI, ...(o.pre ?? []), seg(0xc0, o.sof ?? SOF_P), seg(0xda, o.sos ?? SOS_P), DATA, EOI);
const CLEAN = jpeg();

describe("JPEG: structural segments at spec length", () => {
  it("cuts extra bytes after a DRI payload (spec: 2 bytes)", () => {
    const r = stripImageMetadata(jpeg({ pre: [seg(0xdd, cat(Uint8Array.from([0, 4]), HIDE))] }));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("HIDE");
    expect(r.bytes.length).toBe(jpeg({ pre: [seg(0xdd, Uint8Array.from([0, 4]))] }).length);
    expect(
      inspectImageMetadata(jpeg({ pre: [seg(0xdd, cat(Uint8Array.from([0, 4]), HIDE))] })).hasOther,
    ).toBe(true);
  });
  it("refuses a DRI that is too short", () => {
    expect(() => stripImageMetadata(jpeg({ pre: [seg(0xdd, Uint8Array.from([0]))] }))).toThrow(
      /too short/,
    );
  });
  it("cuts extra bytes after a frame header (spec: 6 + 3*Nf)", () => {
    const r = stripImageMetadata(jpeg({ sof: cat(SOF_P, HIDE) }));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("HIDE");
    expect(r.bytes).toEqual(CLEAN);
    expect(readImageDimensions(r.bytes)).toEqual({ width: 100, height: 80 });
  });
  it("refuses a frame header that declares more components than it holds", () => {
    const bad = SOF_P.slice();
    bad[5] = 3;
    expect(() => stripImageMetadata(jpeg({ sof: bad }))).toThrow(/too short/);
  });
  it("cuts extra bytes after a scan header (spec: 4 + 2*Ns) and keeps the scan data", () => {
    const r = stripImageMetadata(jpeg({ sos: cat(SOS_P, HIDE) }));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("HIDE");
    expect(r.bytes).toEqual(CLEAN);
    expect(inspectImageMetadata(jpeg({ sos: cat(SOS_P, HIDE) })).hasOther).toBe(true);
  });
  it("refuses a scan header with an impossible component count", () => {
    expect(() => stripImageMetadata(jpeg({ sos: Uint8Array.from([9, 1, 0, 0, 63, 0]) }))).toThrow(
      /scan header/,
    );
  });
  it("refuses a quantisation table segment with trailing bytes", () => {
    expect(() =>
      stripImageMetadata(jpeg({ pre: [seg(0xdb, cat(new Uint8Array(65), HIDE))] })),
    ).toThrow(/quantisation/);
    expect(stripImageMetadata(jpeg({ pre: [seg(0xdb, new Uint8Array(130))] })).changed).toBe(false); // two 8-bit tables
  });
  it("refuses a Huffman table segment whose counts do not match its length", () => {
    const counts = cat(Uint8Array.from([0x00, 2]), new Uint8Array(15)); // 2 symbols declared
    expect(() =>
      stripImageMetadata(jpeg({ pre: [seg(0xc4, cat(counts, Uint8Array.from([0])))] })),
    ).toThrow(/Huffman/);
    expect(() =>
      stripImageMetadata(jpeg({ pre: [seg(0xc4, cat(counts, Uint8Array.from([0, 1]), HIDE))] })),
    ).toThrow(/Huffman/);
    expect(
      stripImageMetadata(jpeg({ pre: [seg(0xc4, cat(counts, Uint8Array.from([0, 1])))] })).changed,
    ).toBe(false);
  });
  it("refuses a second start-of-image before the end of image", () => {
    expect(() =>
      stripImageMetadata(cat(SOI, SOI, seg(0xc0, SOF_P), seg(0xda, SOS_P), DATA, EOI)),
    ).toThrow(/second start/);
  });
  it("refuses a file with no scan (no image data)", () => {
    expect(() => stripImageMetadata(cat(SOI, seg(0xc0, SOF_P), EOI))).toThrow(/no image data/);
  });
});

// ---- PNG
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const body = cat(enc.encode(type), data);
  return cat(be32(data.length), body, be32(crc(body)));
};
const SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (colorType: number) =>
  chunk("IHDR", Uint8Array.from([0, 0, 0, 100, 0, 0, 0, 80, 8, colorType, 0, 0, 0]));
const idat = chunk("IDAT", Uint8Array.from([0x78, 0x9c, 0x63, 0, 0, 0, 2, 0, 1]));
const iend = chunk("IEND", new Uint8Array(0));
const png = (colorType: number, ...mid: Uint8Array[]) =>
  cat(SIG, ihdr(colorType), ...mid, idat, iend);

describe("PNG: ancillary chunks at spec length", () => {
  it.each([
    ["pHYs", 9],
    ["sRGB", 1],
    ["gAMA", 4],
    ["cHRM", 32],
  ])("copies %s at %d bytes and cuts anything after", (type, n) => {
    const r = stripImageMetadata(png(2, chunk(type, cat(new Uint8Array(n), HIDE))));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("HIDE");
    expect(r.bytes).toEqual(png(2, chunk(type, new Uint8Array(n))));
    expect(stripImageMetadata(png(2, chunk(type, new Uint8Array(n)))).changed).toBe(false);
    expect(inspectImageMetadata(png(2, chunk(type, cat(new Uint8Array(n), HIDE)))).hasOther).toBe(
      true,
    );
  });
  it("drops a fixed-size chunk that is too short", () => {
    const r = stripImageMetadata(png(2, chunk("pHYs", new Uint8Array(3))));
    expect(r.bytes).toEqual(png(2));
  });
  it("rewrites an IEND that carries data as an empty IEND", () => {
    const f = cat(SIG, ihdr(2), idat, chunk("IEND", HIDE));
    const r = stripImageMetadata(f);
    expect(text(r.bytes)).not.toContain("HIDE");
    expect(r.bytes).toEqual(png(2));
  });
  it("sizes bKGD and sBIT by colour type", () => {
    expect(stripImageMetadata(png(2, chunk("bKGD", new Uint8Array(6)))).changed).toBe(false);
    expect(stripImageMetadata(png(0, chunk("bKGD", new Uint8Array(2)))).changed).toBe(false);
    expect(stripImageMetadata(png(2, chunk("bKGD", cat(new Uint8Array(6), HIDE)))).bytes).toEqual(
      png(2, chunk("bKGD", new Uint8Array(6))),
    );
    expect(stripImageMetadata(png(6, chunk("sBIT", cat(new Uint8Array(4), HIDE)))).bytes).toEqual(
      png(6, chunk("sBIT", new Uint8Array(4))),
    );
  });
  it("drops tRNS where an alpha channel already exists, and bounds a palette tRNS by the palette", () => {
    expect(stripImageMetadata(png(6, chunk("tRNS", HIDE))).bytes).toEqual(png(6));
    const plte = chunk("PLTE", new Uint8Array(6)); // 2 entries
    expect(stripImageMetadata(png(3, plte, chunk("tRNS", Uint8Array.from([0, 255])))).changed).toBe(
      false,
    );
    expect(stripImageMetadata(png(3, plte, chunk("tRNS", HIDE))).bytes).toEqual(png(3, plte));
  });
  it("drops fcTL/fdAT in a file that is not an APNG (no acTL)", () => {
    const fctl = chunk("fcTL", new Uint8Array(26));
    const fdat = chunk("fdAT", cat(new Uint8Array(4), HIDE));
    const still = cat(SIG, ihdr(2), idat, fctl, fdat, iend);
    const r = stripImageMetadata(still);
    expect(text(r.bytes)).not.toMatch(/HIDE|fcTL|fdAT/);
    expect(r.report.animated).toBe(false);
    expect(inspectImageMetadata(still).hasOther).toBe(true);
  });
  it("keeps the frames of a real APNG and reports it as animated", () => {
    const actl = chunk("acTL", Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0]));
    const fctl = chunk("fcTL", new Uint8Array(26));
    const apng = cat(SIG, ihdr(2), actl, fctl, idat, fctl, chunk("fdAT", new Uint8Array(8)), iend);
    const r = stripImageMetadata(apng);
    expect(r.changed).toBe(false);
    expect(r.report.animated).toBe(true);
  });
  it("refuses a PNG with no IDAT, and a malformed IHDR", () => {
    expect(() => stripImageMetadata(cat(SIG, ihdr(2), iend))).toThrow(/no image data/);
    expect(() =>
      stripImageMetadata(cat(SIG, chunk("IHDR", new Uint8Array(14)), idat, iend)),
    ).toThrow(/header/);
  });
});

// ---- WEBP
const wchunk = (type: string, data: Uint8Array) =>
  cat(
    enc.encode(type),
    le32(data.length),
    data,
    data.length & 1 ? new Uint8Array(1) : new Uint8Array(0),
  );
const riff = (body: Uint8Array) =>
  cat(enc.encode("RIFF"), le32(4 + body.length), enc.encode("WEBP"), body);
const vp8l = wchunk("VP8L", Uint8Array.from([0x2f, 99, 0xc0, 0x13, 0x00, 0x07, 0x10, 0x11, 0x11]));
const vp8x = (flags = 0) => wchunk("VP8X", Uint8Array.from([flags, 0, 0, 0, 99, 0, 0, 79, 0, 0]));

describe("WEBP: VP8X and ANIM at spec length, image data required", () => {
  it("cuts extra bytes after VP8X (spec: 10)", () => {
    const big = wchunk("VP8X", cat(Uint8Array.from([0, 0, 0, 0, 99, 0, 0, 79, 0, 0]), HIDE));
    const r = stripImageMetadata(riff(cat(big, vp8l)));
    expect(text(r.bytes)).not.toContain("HIDE");
    expect(r.bytes).toEqual(riff(cat(vp8x(), vp8l)));
    expect(inspectImageMetadata(riff(cat(big, vp8l))).hasOther).toBe(true);
  });
  it("zeroes reserved VP8X bits and bytes", () => {
    const f = riff(cat(wchunk("VP8X", Uint8Array.from([0xc1, 7, 7, 7, 99, 0, 0, 79, 0, 0])), vp8l));
    const r = stripImageMetadata(f);
    expect(r.bytes).toEqual(riff(cat(vp8x(), vp8l)));
    expect(r.report.hasOther).toBe(true);
  });
  it("cuts extra bytes after ANIM (spec: 6) and reports the file as animated", () => {
    const frame = wchunk("ANMF", cat(new Uint8Array(16), vp8l));
    const f = riff(cat(vp8x(0x02), wchunk("ANIM", cat(new Uint8Array(6), HIDE)), frame));
    const r = stripImageMetadata(f);
    expect(text(r.bytes)).not.toContain("HIDE");
    expect(r.bytes).toEqual(riff(cat(vp8x(0x02), wchunk("ANIM", new Uint8Array(6)), frame)));
    expect(r.report.animated).toBe(true);
  });
  it("refuses a WEBP with no VP8/VP8L image data", () => {
    expect(() => stripImageMetadata(riff(vp8x()))).toThrow(/no image data/);
    expect(() => stripImageMetadata(riff(cat(vp8x(), wchunk("ICCP", HIDE))))).toThrow(
      /no image data/,
    );
  });
  it("a still WEBP is not animated", () => {
    expect(stripImageMetadata(riff(vp8l)).report.animated).toBe(false);
  });
});
