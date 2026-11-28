import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "./image-metadata";

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
const seg = (m: number, payload: Uint8Array) =>
  cat(Uint8Array.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
const sof = seg(0xc0, Uint8Array.from([8, 0, 80, 0, 100, 1, 1, 0x11, 0]));
const sos = seg(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0]));
const gpsApp1 = seg(0xe1, enc.encode("Exif\0\0GPS 33.7488,-84.3877"));
const SOI = Uint8Array.from([0xff, 0xd8]);
const EOI = Uint8Array.from([0xff, 0xd9]);
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("JPEG stripper: data after the first scan", () => {
  it("drops a second image (motion photo, MPF secondary) appended after EOI", () => {
    const first = cat(SOI, sof, sos, Uint8Array.from([1, 2, 3]), EOI);
    const second = cat(SOI, gpsApp1, sof, sos, Uint8Array.from([9, 9]), EOI);
    const r = stripImageMetadata(cat(first, second));
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("GPS");
    expect(r.bytes.length).toBe(first.length);
  });
  it("drops arbitrary trailing bytes after EOI", () => {
    const r = stripImageMetadata(
      cat(SOI, sof, sos, Uint8Array.from([1, 2]), EOI, enc.encode("<html>TAIL</html>")),
    );
    expect(r.changed).toBe(true);
    expect(text(r.bytes)).not.toContain("TAIL");
  });
  it("drops metadata placed between the scans of a progressive file, and keeps both scans", () => {
    const f = cat(
      SOI,
      sof,
      sos,
      Uint8Array.from([1, 2, 0xff, 0x00, 3]),
      gpsApp1,
      sos,
      Uint8Array.from([4, 5]),
      EOI,
    );
    const r = stripImageMetadata(f);
    expect(r.changed).toBe(true);
    expect(r.report.hasExif).toBe(true);
    expect(text(r.bytes)).not.toContain("GPS");
    expect(r.bytes.filter((_, i, a) => a[i] === 0xff && a[i + 1] === 0xda).length).toBe(2);
  });
  it("treats 0xFF00 and restart markers inside the scan as data, not as the end of the scan", () => {
    const f = cat(SOI, sof, sos, Uint8Array.from([0xff, 0x00, 0xff, 0xd0, 7, 0xff, 0xd1, 8]), EOI);
    const r = stripImageMetadata(f);
    expect(r.changed).toBe(false);
  });
  it("refuses a file with no end of image", () => {
    expect(() => stripImageMetadata(cat(SOI, sof, sos, Uint8Array.from([1, 2, 3])))).toThrow(
      /Truncated/,
    );
  });
  it("leaves a clean file byte-for-byte unchanged", () => {
    const f = cat(SOI, sof, sos, Uint8Array.from([1, 2, 3]), EOI);
    const r = stripImageMetadata(f);
    expect(r.changed).toBe(false);
    expect(r.bytes).toBe(f);
  });
});
