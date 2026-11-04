import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "./image-metadata";

// Allow-list parsing: only segments/chunks needed to draw the picture survive; anything else is dropped or the file is refused.
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
const le32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
const be32 = (n: number) => Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);

// ---- JPEG
const seg = (m: number, payload: Uint8Array) =>
  cat(Uint8Array.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
const SOI = Uint8Array.from([0xff, 0xd8]);
const EOI = Uint8Array.from([0xff, 0xd9]);
const sof = seg(0xc0, Uint8Array.from([8, 0, 80, 0, 100, 1, 1, 0x11, 0]));
const sos = seg(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0]));
const jpeg = (...mid: Uint8Array[]) => cat(SOI, ...mid, sof, sos, Uint8Array.from([1, 2, 3]), EOI);
const jfifHeader = (tw: number, th: number) =>
  cat(enc.encode("JFIF\0"), Uint8Array.from([1, 2, 0, 0, 72, 0, 72, tw, th]));

describe("JPEG allow-list", () => {
  it("keeps a plain 16-byte JFIF APP0 unchanged", () => {
    const f = jpeg(seg(0xe0, jfifHeader(0, 0)));
    const r = stripImageMetadata(f);
    expect(r.changed).toBe(false);
  });
  it("drops a JFIF thumbnail but keeps the JFIF header with a 0x0 thumbnail", () => {
    const thumb = enc.encode("THUMBPIXELS!".repeat(4)).subarray(0, 2 * 2 * 3);
    const r = stripImageMetadata(jpeg(seg(0xe0, cat(jfifHeader(2, 2), thumb))));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("THUMB");
    expect(text(r.bytes)).toContain("JFIF");
    expect(r.bytes.length).toBe(jpeg(seg(0xe0, jfifHeader(0, 0))).length);
  });
  it("drops a JFXX extension APP0", () => {
    const r = stripImageMetadata(jpeg(seg(0xe0, enc.encode("JFXX\0\x13THUMBNAIL"))));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("THUMBNAIL");
  });
  it("truncates APP14 to the 12-byte Adobe header and drops a non-Adobe APP14", () => {
    const adobe = cat(enc.encode("Adobe"), Uint8Array.from([0, 100, 0, 0, 0, 0, 1]));
    expect(stripImageMetadata(jpeg(seg(0xee, adobe))).changed).toBe(false);
    const padded = stripImageMetadata(jpeg(seg(0xee, cat(adobe, enc.encode("HIDDEN-GPS")))));
    expect(padded.changed).toBe(true);
    expect(text(padded.bytes)).not.toContain("HIDDEN");
    expect(text(padded.bytes)).toContain("Adobe");
    const other = stripImageMetadata(jpeg(seg(0xee, enc.encode("Vendor HIDDEN"))));
    expect(text(other.bytes)).not.toContain("HIDDEN");
  });
  it("drops JPGn extension and reserved markers", () => {
    const r = stripImageMetadata(
      jpeg(seg(0xf0, enc.encode("HIDDEN")), seg(0xc8, enc.encode("HIDDEN2"))),
    );
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("HIDDEN");
  });
  it("keeps tables and restart definitions", () => {
    const f = jpeg(
      seg(0xdb, new Uint8Array(65)),
      seg(0xc4, new Uint8Array(20)),
      seg(0xdd, Uint8Array.from([0, 4])),
    );
    expect(stripImageMetadata(f).changed).toBe(false);
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
const ihdr = chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]));
const idat = chunk("IDAT", Uint8Array.from([0x78, 0x9c, 0x63, 0, 0, 0, 2, 0, 1]));
const iend = chunk("IEND", new Uint8Array(0));

describe("PNG allow-list", () => {
  it("keeps a clean PNG unchanged", () => {
    expect(stripImageMetadata(cat(SIG, ihdr, idat, iend)).changed).toBe(false);
  });
  it("refuses a PNG whose first chunk is not IHDR", () => {
    expect(() => stripImageMetadata(cat(SIG, idat, ihdr, iend))).toThrow(/IHDR/);
  });
  it("refuses a second IHDR", () => {
    expect(() => stripImageMetadata(cat(SIG, ihdr, ihdr, idat, iend))).toThrow(/IHDR/);
  });
  it("refuses a PNG without IEND", () => {
    expect(() => stripImageMetadata(cat(SIG, ihdr, idat))).toThrow(/IEND/);
  });
  it("refuses an unknown critical chunk (cannot be dropped safely)", () => {
    expect(() =>
      stripImageMetadata(cat(SIG, ihdr, chunk("ZZZZ", enc.encode("x")), idat, iend)),
    ).toThrow(/critical/);
  });
  it("drops unknown ancillary chunks and data after IEND", () => {
    const r = stripImageMetadata(
      cat(SIG, ihdr, chunk("vpAg", enc.encode("HIDDEN")), idat, iend, enc.encode("TRAILER")),
    );
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toMatch(/HIDDEN|TRAILER/);
    expect(r.bytes.length).toBe(cat(SIG, ihdr, idat, iend).length);
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
const vp8l = wchunk("VP8L", Uint8Array.from([0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11]));
const vp8x = wchunk("VP8X", Uint8Array.from([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
const anim = wchunk("ANIM", new Uint8Array(6));

describe("WEBP allow-list", () => {
  it("keeps a clean still WEBP unchanged", () => {
    expect(stripImageMetadata(riff(vp8l)).changed).toBe(false);
  });
  it("drops unknown chunks and recomputes the RIFF size", () => {
    const r = stripImageMetadata(riff(cat(vp8x, vp8l, wchunk("ZZZZ", enc.encode("HIDDEN-GPS")))));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("HIDDEN");
    const size = r.bytes[4] | (r.bytes[5] << 8) | (r.bytes[6] << 16) | (r.bytes[7] << 24);
    expect(size + 8).toBe(r.bytes.length);
  });
  it("drops data appended after the RIFF container", () => {
    const r = stripImageMetadata(cat(riff(vp8l), enc.encode("TRAILER")));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("TRAILER");
    expect(r.bytes.length).toBe(riff(vp8l).length);
  });
  it("drops unknown sub-chunks inside an animation frame and keeps the frame image", () => {
    const frame = (inner: Uint8Array) => wchunk("ANMF", cat(new Uint8Array(16), inner));
    const r = stripImageMetadata(
      riff(cat(vp8x, anim, frame(cat(vp8l, wchunk("XMP ", enc.encode("HIDDEN")))))),
    );
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("HIDDEN");
    expect(text(r.bytes)).toContain("VP8L");
    const clean = riff(cat(vp8x, anim, frame(vp8l)));
    expect(r.bytes.length).toBe(clean.length);
  });
  it("refuses a chunk that runs past the RIFF size", () => {
    const body = cat(vp8l, enc.encode("ICCP"), le32(100), new Uint8Array(4));
    expect(() => stripImageMetadata(riff(body))).toThrow(/Malformed|Truncated/);
  });
});
