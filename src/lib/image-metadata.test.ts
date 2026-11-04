import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasPersonalMetadata, inspectImageMetadata, stripImageMetadata } from "./image-metadata";
import { readImageDimensions } from "./image-validation";

const enc = new TextEncoder();
const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) (o.set(x, k), (k += x.length));
  return o;
};

/** A big-endian TIFF block with Make, Orientation and a GPS sub-IFD (what a phone writes). */
function tiffWithGps(orientation: number): Uint8Array {
  const make = enc.encode("PhoneCo\0"); // 8 bytes
  const gps = new Uint8Array(2 + 12 + 4);
  const g = new DataView(gps.buffer);
  g.setUint16(0, 1);
  g.setUint16(2, 1); // GPSLatitudeRef
  g.setUint16(4, 2);
  g.setUint32(6, 2);
  gps.set(enc.encode("N\0"), 10);
  const ifd0Len = 2 + 3 * 12 + 4;
  const makeAt = 8 + ifd0Len;
  const gpsAt = makeAt + make.length;
  const ifd = new Uint8Array(ifd0Len);
  const d = new DataView(ifd.buffer);
  d.setUint16(0, 3);
  d.setUint16(2, 0x010f);
  d.setUint16(4, 2);
  d.setUint32(6, 8);
  d.setUint32(10, makeAt);
  d.setUint16(14, 0x0112);
  d.setUint16(16, 3);
  d.setUint32(18, 1);
  d.setUint16(22, orientation);
  d.setUint16(26, 0x8825);
  d.setUint16(28, 4);
  d.setUint32(30, 1);
  d.setUint32(34, gpsAt);
  return cat(Uint8Array.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]), ifd, make, gps);
}

const seg = (marker: number, payload: Uint8Array) =>
  cat(
    Uint8Array.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]),
    payload,
  );

function jpeg(opts: { orientation?: number; gps?: boolean; extras?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])];
  parts.push(seg(0xe0, enc.encode("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")));
  if (opts.gps || opts.orientation)
    parts.push(seg(0xe1, cat(enc.encode("Exif\0\0"), tiffWithGps(opts.orientation ?? 1))));
  if (opts.extras) {
    parts.push(
      seg(0xe1, enc.encode("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>SECRET-XMP</x:xmpmeta>")),
    );
    parts.push(seg(0xed, enc.encode("Photoshop 3.0\0SECRET-IPTC")));
    parts.push(seg(0xfe, enc.encode("SECRET-COMMENT")));
    parts.push(seg(0xe2, enc.encode("ICC_PROFILE\0\x01\x01profile-bytes")));
  }
  parts.push(seg(0xdb, new Uint8Array(65)));
  parts.push(seg(0xc0, Uint8Array.from([8, 0, 80, 0, 100, 1, 1, 0x11, 0])));
  parts.push(seg(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])));
  parts.push(Uint8Array.from([1, 2, 3, 0xff, 0xd9]));
  return cat(...parts);
}

let crcTable: number[] | null = null;
function crc(b: Uint8Array) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable.push(c >>> 0);
    }
  }
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const chunk = (type: string, data: Uint8Array) => {
  const body = cat(enc.encode(type), data);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(body, 4);
  dv.setUint32(8 + data.length, crc(body));
  return out;
};
function png(opts: { orientation?: number; extras?: boolean } = {}): Uint8Array {
  const ihdr = new Uint8Array(13);
  const d = new DataView(ihdr.buffer);
  d.setUint32(0, 100);
  d.setUint32(4, 80);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
  ];
  if (opts.orientation) parts.push(chunk("eXIf", tiffWithGps(opts.orientation)));
  if (opts.extras) {
    parts.push(chunk("tEXt", enc.encode("Location\0SECRET-TEXT")));
    parts.push(chunk("iTXt", enc.encode("XML:com.adobe.xmp\0\0\0\0\0SECRET-XMP")));
    parts.push(chunk("tIME", new Uint8Array(7)));
    parts.push(chunk("gAMA", Uint8Array.from([0, 1, 0x86, 0xa0])));
  }
  parts.push(chunk("IDAT", Uint8Array.from([1, 2, 3, 4])), chunk("IEND", new Uint8Array(0)));
  return cat(...parts);
}

function webp(opts: { orientation?: number; extras?: boolean } = {}): Uint8Array {
  const riffChunk = (type: string, data: Uint8Array) => {
    const h = new Uint8Array(8);
    h.set(enc.encode(type), 0);
    new DataView(h.buffer).setUint32(4, data.length, true);
    return cat(h, data, data.length & 1 ? Uint8Array.from([0]) : new Uint8Array(0));
  };
  const vp8x = new Uint8Array(10);
  vp8x[0] = (opts.orientation ? 0x08 : 0) | (opts.extras ? 0x04 : 0) | 0x20; // EXIF, XMP, ICC flag
  vp8x[4] = 99; // width-1
  vp8x[7] = 79; // height-1
  const body = cat(
    enc.encode("WEBP"),
    riffChunk("VP8X", vp8x),
    riffChunk("VP8 ", Uint8Array.from([1, 2, 3, 4, 5])),
    ...(opts.orientation
      ? [riffChunk("EXIF", cat(enc.encode("Exif\0\0"), tiffWithGps(opts.orientation)))]
      : []),
    ...(opts.extras ? [riffChunk("XMP ", enc.encode("<x:xmpmeta>SECRET-XMP</x:xmpmeta>"))] : []),
  );
  const out = cat(enc.encode("RIFF"), new Uint8Array(4), body);
  new DataView(out.buffer).setUint32(4, body.length, true);
  return out;
}

describe("stripImageMetadata: JPEG", () => {
  it("removes GPS, EXIF, XMP, IPTC and comments and keeps what draws the image", () => {
    const src = jpeg({ gps: true, orientation: 6, extras: true });
    expect(inspectImageMetadata(src)).toMatchObject({
      hasExif: true,
      hasGps: true,
      hasXmp: true,
      orientation: 6,
    });
    const out = stripImageMetadata(src);
    const t = text(out.bytes);
    expect(out.changed).toBe(true);
    for (const secret of [
      "SECRET-XMP",
      "SECRET-IPTC",
      "SECRET-COMMENT",
      "PhoneCo",
      "xap/1.0",
      "Photoshop",
    ]) {
      expect(t).not.toContain(secret);
    }
    expect(t).toContain("JFIF");
    expect(t).toContain("ICC_PROFILE");
    expect(readImageDimensions(out.bytes)).toEqual({ width: 100, height: 80 });
    expect(Array.from(out.bytes.slice(-5))).toEqual([1, 2, 3, 0xff, 0xd9]);
    const after = inspectImageMetadata(out.bytes);
    expect(after.hasGps).toBe(false);
    expect(after.hasXmp).toBe(false);
    expect(after.hasOther).toBe(false);
    expect(after.orientation).toBe(6); // the photo still displays upright
  });
  it("drops EXIF entirely when the orientation is normal", () => {
    const out = stripImageMetadata(jpeg({ gps: true, orientation: 1 }));
    expect(out.changed).toBe(true);
    expect(inspectImageMetadata(out.bytes).hasExif).toBe(false);
  });
  it("is idempotent and returns the same array when there is nothing to remove", () => {
    const once = stripImageMetadata(jpeg({ gps: true, orientation: 8, extras: true }));
    const twice = stripImageMetadata(once.bytes);
    expect(twice.changed).toBe(false);
    expect(twice.bytes).toBe(once.bytes);
    const clean = jpeg();
    const r = stripImageMetadata(clean);
    expect(r.changed).toBe(false);
    expect(r.bytes).toBe(clean);
  });
  it("throws on a truncated or malformed file instead of publishing it", () => {
    const bad = jpeg({ gps: true, orientation: 6 }).slice(0, 30);
    expect(() => stripImageMetadata(bad)).toThrow();
    expect(() =>
      stripImageMetadata(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
    ).toThrow();
  });
  it.each(["o1.jpg", "o3.jpg", "o6.jpg", "o8.jpg"])(
    "keeps the picture and orientation of the real fixture %s",
    (name) => {
      const src = new Uint8Array(
        readFileSync(new URL(`../../e2e/fixtures/exif/${name}`, import.meta.url)),
      );
      const before = inspectImageMetadata(src);
      const out = stripImageMetadata(src);
      expect(readImageDimensions(out.bytes)).toEqual(readImageDimensions(src));
      const after = inspectImageMetadata(out.bytes);
      expect(after.hasGps).toBe(false);
      expect(after.orientation).toBe(
        before.orientation && before.orientation !== 1 ? before.orientation : null,
      );
      expect(stripImageMetadata(out.bytes).changed).toBe(false);
    },
  );
});

describe("stripImageMetadata: PNG", () => {
  it("removes text, XMP, time and EXIF/GPS, keeps gamma, and keeps orientation", () => {
    const src = png({ orientation: 3, extras: true });
    expect(inspectImageMetadata(src)).toMatchObject({
      hasExif: true,
      hasGps: true,
      hasXmp: true,
      orientation: 3,
    });
    const out = stripImageMetadata(src);
    const t = text(out.bytes);
    expect(out.changed).toBe(true);
    expect(t).not.toContain("SECRET");
    expect(t).not.toContain("tIME");
    expect(t).toContain("gAMA");
    expect(readImageDimensions(out.bytes)).toEqual({ width: 100, height: 80 });
    const after = inspectImageMetadata(out.bytes);
    expect(after).toMatchObject({ hasGps: false, hasXmp: false, hasOther: false, orientation: 3 });
    expect(stripImageMetadata(out.bytes).changed).toBe(false);
  });
  it("leaves a clean PNG alone", () => {
    const clean = png();
    expect(stripImageMetadata(clean).bytes).toBe(clean);
  });
});

describe("stripImageMetadata: WEBP", () => {
  it("removes EXIF/GPS and XMP, fixes the flags and the RIFF size, keeps orientation", () => {
    const src = webp({ orientation: 6, extras: true });
    expect(inspectImageMetadata(src)).toMatchObject({
      hasExif: true,
      hasGps: true,
      hasXmp: true,
      orientation: 6,
    });
    const out = stripImageMetadata(src);
    const t = text(out.bytes);
    expect(t).not.toContain("SECRET-XMP");
    expect(t).not.toContain("PhoneCo");
    expect(new DataView(out.bytes.buffer, out.bytes.byteOffset).getUint32(4, true)).toBe(
      out.bytes.length - 8,
    );
    expect(out.bytes[20] & 0x04).toBe(0); // XMP flag off (flags byte of VP8X is at offset 20)
    const after = inspectImageMetadata(out.bytes);
    expect(after).toMatchObject({ hasGps: false, hasXmp: false, orientation: 6 });
    expect(stripImageMetadata(out.bytes).changed).toBe(false);
  });
  it("clears the EXIF flag when no orientation needs keeping", () => {
    const out = stripImageMetadata(webp({ orientation: 1, extras: true }));
    expect(out.bytes[20] & 0x0c).toBe(0);
    expect(hasPersonalMetadata(inspectImageMetadata(out.bytes))).toBe(false);
  });
});
