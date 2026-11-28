/**
 * G3 on main: the stripper that finalizeImageUpload, finalizeMessageAttachment and the direct-upload paths use. The
 * other image-metadata tests (ported from the G3/G3b branches) cover the allow-lists in detail; these cover what the
 * privacy register promises: GPS gone, the picture itself byte for byte the same and still decodable, and no input,
 * however broken, makes the caller's helper throw.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { stripImageMetadata, tryStripImageMetadata } from "./image-metadata";
import { readImageDimensions, sniffImageMime } from "./image-validation";

const enc = new TextEncoder();
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) {
    o.set(x, k);
    k += x.length;
  }
  return o;
};
const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const be16 = (n: number) => Uint8Array.from([n >> 8, n & 255]);
const be32 = (n: number) => Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);

/** A big-endian TIFF block like a phone writes: Make, Orientation and a GPS IFD with a latitude reference. */
function phoneTiff(orientation = 1): Uint8Array {
  const make = enc.encode("PhoneCo\0");
  const ifd0 = 2 + 3 * 12 + 4;
  const makeAt = 8 + ifd0;
  const gpsAt = makeAt + make.length;
  const ifd = cat(
    be16(3),
    cat(be16(0x010f), be16(2), be32(make.length), be32(makeAt)), // Make
    cat(be16(0x0112), be16(3), be32(1), be16(orientation), be16(0)), // Orientation
    cat(be16(0x8825), be16(4), be32(1), be32(gpsAt)), // GPS IFD pointer
    be32(0),
  );
  const gps = cat(be16(1), cat(be16(1), be16(2), be32(2), enc.encode("N\0\0\0")), be32(0));
  return cat(enc.encode("MM\0*"), be32(8), ifd, make, gps);
}
const GPS_TEXT = "GPS 33.7488,-84.3877";
const app = (marker: number, payload: Uint8Array) =>
  cat(Uint8Array.from([0xff, marker]), be16(payload.length + 2), payload);
const exifApp1 = (orientation = 1) =>
  app(0xe1, cat(enc.encode("Exif\0\0"), phoneTiff(orientation), enc.encode(GPS_TEXT)));

// ------------------------------------------------------------------------------------------- JPEG
/** A JPEG built by hand: SOI, APP1 Exif with GPS, DQT, SOF0, DHT, SOS, entropy data with stuffing and a restart, EOI. */
function handJpeg(withExif: boolean) {
  const soi = Uint8Array.from([0xff, 0xd8]);
  const dqt = app(0xdb, cat(Uint8Array.from([0]), new Uint8Array(64).fill(1)));
  const sof = app(0xc0, Uint8Array.from([8, 0, 64, 0, 64, 1, 1, 0x11, 0]));
  const dht = app(0xc4, cat(Uint8Array.from([0, 1]), new Uint8Array(15), Uint8Array.from([0])));
  const sos = app(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0]));
  // Entropy-coded bytes include a stuffed 0xFF00 and an RST0 marker, which belong to the scan and must survive.
  const scan = Uint8Array.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]);
  const eoi = Uint8Array.from([0xff, 0xd9]);
  const head = withExif ? [soi, exifApp1()] : [soi];
  return {
    bytes: cat(...head, dqt, sof, dht, sos, scan, eoi),
    clean: cat(soi, dqt, sof, dht, sos, scan, eoi),
    scan,
  };
}

/** Segment markers in order, walking headers and skipping entropy data, to check the structure is intact. */
function jpegMarkers(b: Uint8Array): number[] {
  const out: number[] = [b[0] === 0xff && b[1] === 0xd8 ? 0xd8 : -1];
  let i = 2;
  while (i + 1 < b.length) {
    const m = b[i + 1]!;
    out.push(m);
    if (m === 0xd9) break;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    i += 2 + len;
    if (m === 0xda) {
      while (
        i + 1 < b.length &&
        !(b[i] === 0xff && b[i + 1] !== 0 && (b[i + 1]! < 0xd0 || b[i + 1]! > 0xd7))
      )
        i++;
    }
  }
  return out;
}

describe("G3 JPEG: APP1 Exif with GPS", () => {
  it("removes the Exif segment and leaves SOI, tables, SOF, SOS, the scan bytes and EOI exactly as they were", () => {
    const { bytes, clean, scan } = handJpeg(true);
    expect(latin1(bytes)).toContain(GPS_TEXT);
    const r = stripImageMetadata(bytes);
    expect(r.changed).toBe(true);
    expect(r.report).toMatchObject({ format: "jpeg", hasExif: true, hasGps: true });
    expect(latin1(r.bytes)).not.toContain("Exif");
    expect(latin1(r.bytes)).not.toContain(GPS_TEXT);
    expect(latin1(r.bytes)).not.toContain("PhoneCo");
    expect(r.bytes).toEqual(clean);
    expect(jpegMarkers(r.bytes)).toEqual([0xd8, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
    expect(latin1(r.bytes)).toContain(latin1(scan));
    expect(sniffImageMime(r.bytes)).toBe("image/jpeg");
    expect(readImageDimensions(r.bytes)).toEqual({ width: 64, height: 64 });
  });

  it("keeps a sideways photo upright with an Exif block that holds the orientation and nothing else", () => {
    const { bytes } = handJpeg(false);
    const sideways = cat(bytes.subarray(0, 2), exifApp1(6), bytes.subarray(2));
    const r = stripImageMetadata(sideways);
    expect(r.report.orientation).toBe(6);
    const text = latin1(r.bytes);
    expect(text).toContain("Exif\0\0MM");
    expect(text).not.toContain(GPS_TEXT);
    expect(text).not.toContain("PhoneCo");
    // The new block has one IFD entry (Orientation) and so no GPS pointer (tag 0x8825) at all.
    const at = text.indexOf("Exif\0\0") + 6;
    const tiff = r.bytes.subarray(at);
    expect((tiff[8]! << 8) | tiff[9]!).toBe(1);
    expect((tiff[10]! << 8) | tiff[11]!).toBe(0x0112);
    expect(stripImageMetadata(r.bytes).report.hasGps).toBe(false);
  });

  it("on a real encoder's JPEG gives back the encoder's own bytes, which decode to the same pixels", async () => {
    const original = u8(
      await sharp({ create: { width: 64, height: 48, channels: 3, background: "#336699" } })
        .jpeg()
        .toBuffer(),
    );
    const tagged = cat(original.subarray(0, 2), exifApp1(), original.subarray(2));
    const r = stripImageMetadata(tagged);
    expect(r.changed).toBe(true);
    expect(r.bytes).toEqual(original);
    const meta = await sharp(r.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([64, 48]);
    const [a, b] = await Promise.all([
      sharp(original).raw().toBuffer(),
      sharp(r.bytes).raw().toBuffer(),
    ]);
    expect(b.equals(a)).toBe(true);
  });

  it("removes the Exif, GPS and XMP an encoder writes itself", async () => {
    const tagged = u8(
      await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } })
        .jpeg()
        .withExif({
          IFD0: { Make: "PhoneCo", Copyright: "Owner Name" },
          IFD3: { GPSLatitudeRef: "N", GPSLatitude: "33/1 44/1 0/1" },
        })
        .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">OWNER-XMP</x:xmpmeta>')
        .toBuffer(),
    );
    const r = stripImageMetadata(tagged);
    expect(r.report).toMatchObject({ hasExif: true, hasXmp: true });
    const meta = await sharp(r.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(latin1(r.bytes)).not.toMatch(/PhoneCo|Owner Name|OWNER-XMP/);
  });
});

// -------------------------------------------------------------------------------------------- PNG
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const body = cat(enc.encode(type), data);
  return cat(be32(data.length), body, be32(crc(body)));
};
/** Every chunk as [type, crc is valid], walking from the signature to IEND. */
function pngChunks(b: Uint8Array): [string, boolean][] {
  const out: [string, boolean][] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const type = latin1(b.subarray(i + 4, i + 8));
    const stored =
      ((b[i + 8 + len]! << 24) |
        (b[i + 9 + len]! << 16) |
        (b[i + 10 + len]! << 8) |
        b[i + 11 + len]!) >>>
      0;
    out.push([type, stored === crc(b.subarray(i + 4, i + 8 + len))]);
    i += 12 + len;
  }
  return out;
}

describe("G3 PNG: tEXt and eXIf", () => {
  it("drops tEXt, eXIf and tIME; IHDR, IDAT and IEND stay byte for byte with valid CRCs", async () => {
    const original = u8(
      await sharp({ create: { width: 64, height: 64, channels: 4, background: "#33669980" } })
        .png()
        .toBuffer(),
    );
    const ihdrEnd = 8 + 25;
    const tagged = cat(
      original.subarray(0, ihdrEnd),
      chunk("tEXt", enc.encode(`Comment\0${GPS_TEXT}`)),
      chunk("eXIf", phoneTiff()),
      chunk("tIME", Uint8Array.from([7, 234, 11, 27, 12, 0, 0])),
      original.subarray(ihdrEnd),
    );
    expect(pngChunks(tagged).map(([t]) => t)).toContain("eXIf");
    const r = stripImageMetadata(tagged);
    expect(r.report).toMatchObject({ format: "png", hasExif: true, hasGps: true, hasOther: true });
    expect(r.bytes).toEqual(original);
    const chunks = pngChunks(r.bytes);
    expect(chunks.map(([t]) => t)).toEqual(pngChunks(original).map(([t]) => t));
    expect(chunks.map(([t]) => t)).not.toContain("tEXt");
    expect(chunks.every(([, ok]) => ok)).toBe(true);
    expect(chunks[0]![0]).toBe("IHDR");
    expect(chunks.at(-1)![0]).toBe("IEND");
    expect(latin1(r.bytes)).not.toContain(GPS_TEXT);
    const [a, b] = await Promise.all([
      sharp(original).raw().toBuffer(),
      sharp(r.bytes).raw().toBuffer(),
    ]);
    expect(b.equals(a)).toBe(true);
  });

  it("writes a new eXIf with a valid CRC when only the orientation is kept", () => {
    const base = cat(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", cat(be32(64), be32(64), Uint8Array.from([8, 2, 0, 0, 0]))),
      chunk("eXIf", phoneTiff(8)),
      chunk("IDAT", Uint8Array.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
      chunk("IEND", new Uint8Array(0)),
    );
    const r = stripImageMetadata(base);
    expect(r.report.orientation).toBe(8);
    const chunks = pngChunks(r.bytes);
    expect(chunks.map(([t]) => t)).toEqual(["IHDR", "eXIf", "IDAT", "IEND"]);
    expect(chunks.every(([, ok]) => ok)).toBe(true);
    expect(latin1(r.bytes)).not.toContain("PhoneCo");
    expect(stripImageMetadata(r.bytes).report.hasGps).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------- WEBP
describe("G3 WEBP: EXIF and XMP chunks", () => {
  it("drops them, clears the VP8X flags and rewrites the RIFF size; the picture decodes the same", async () => {
    const plain = sharp({ create: { width: 64, height: 64, channels: 3, background: "#00aa55" } });
    const original = u8(await plain.clone().webp({ lossless: true }).toBuffer());
    const tagged = u8(
      await plain
        .clone()
        .webp({ lossless: true })
        .withExif({ IFD0: { Make: "PhoneCo" }, IFD3: { GPSLatitudeRef: "N" } })
        .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">OWNER-XMP</x:xmpmeta>')
        .toBuffer(),
    );
    expect(latin1(tagged)).toContain("VP8X");
    const r = stripImageMetadata(tagged);
    expect(r.report).toMatchObject({ format: "webp", hasExif: true, hasXmp: true });
    const text = latin1(r.bytes);
    expect(text).not.toMatch(/EXIF|XMP |PhoneCo|OWNER-XMP/);
    const riff = r.bytes[4]! | (r.bytes[5]! << 8) | (r.bytes[6]! << 16) | (r.bytes[7]! << 24);
    expect(riff).toBe(r.bytes.length - 8);
    const vp8x = text.indexOf("VP8X");
    expect(r.bytes[vp8x + 8]! & 0x0c).toBe(0);
    const meta = await sharp(r.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    const [a, b] = await Promise.all([
      sharp(original).raw().toBuffer(),
      sharp(r.bytes).raw().toBuffer(),
    ]);
    expect(b.equals(a)).toBe(true);
  });

  it("a hand-built VP8X file loses an EXIF chunk with GPS and keeps an even-padded layout", () => {
    const vp8l = cat(
      enc.encode("VP8L"),
      le32(5),
      Uint8Array.from([0x2f, 0x3f, 0xc0, 0x0f, 0]),
      new Uint8Array(1),
    );
    const vp8x = cat(
      enc.encode("VP8X"),
      le32(10),
      Uint8Array.from([0x08, 0, 0, 0, 63, 0, 0, 63, 0, 0]),
    );
    const exifData = phoneTiff();
    const exif = cat(
      enc.encode("EXIF"),
      le32(exifData.length),
      exifData,
      new Uint8Array(exifData.length & 1),
    );
    const body = cat(enc.encode("WEBP"), vp8x, vp8l, exif);
    const file = cat(enc.encode("RIFF"), le32(body.length), body);
    const r = stripImageMetadata(file);
    expect(r.report.hasGps).toBe(true);
    expect(latin1(r.bytes)).not.toContain("EXIF");
    expect(r.bytes.length % 2).toBe(0);
    expect(r.bytes[20]! & 0x08).toBe(0);
    expect(readImageDimensions(r.bytes)).toEqual({ width: 64, height: 64 });
  });
});

// --------------------------------------------------------------------------------------- general
describe("G3 stripper: clean files, idempotence and malformed input", () => {
  it("returns a clean encoder file untouched (the same array), so finalize writes nothing back", async () => {
    const s = sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ff00" } });
    for (const b of [
      u8(await s.clone().png().toBuffer()),
      u8(await s.clone().webp({ lossless: true }).toBuffer()),
      u8(await s.clone().webp().toBuffer()),
      u8(await s.clone().jpeg().toBuffer()),
    ]) {
      const r = stripImageMetadata(b);
      expect(r.changed).toBe(false);
      expect(r.bytes).toBe(b);
    }
  });

  it("is idempotent: stripping its own output changes nothing", () => {
    const { bytes } = handJpeg(true);
    const once = stripImageMetadata(
      cat(bytes.subarray(0, 2), exifApp1(6), bytes.subarray(2)),
    ).bytes;
    const twice = stripImageMetadata(once);
    expect(twice.changed).toBe(false);
    expect(twice.bytes).toEqual(once);
  });

  it("tryStripImageMetadata never throws: every truncation, byte flips and garbage come back as ok or a refusal", async () => {
    const fixtures = [
      handJpeg(true).bytes,
      u8(
        await sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ff00" } })
          .png()
          .withExif({ IFD0: { Make: "PhoneCo" } })
          .toBuffer(),
      ),
      u8(
        await sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ff00" } })
          .webp()
          .withExif({ IFD0: { Make: "PhoneCo" } })
          .toBuffer(),
      ),
    ];
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let refused = 0;
    for (const f of fixtures) {
      const variants: Uint8Array[] = [];
      for (let n = 0; n < f.length; n++) variants.push(f.subarray(0, n));
      for (let k = 0; k < 300; k++) {
        const v = f.slice();
        const flips = 1 + Math.floor(rand() * 4);
        for (let j = 0; j < flips; j++) v[Math.floor(rand() * v.length)] = Math.floor(rand() * 256);
        variants.push(v);
      }
      for (const v of variants) {
        const r = tryStripImageMetadata(v);
        expect(typeof r.ok).toBe("boolean");
        if (!r.ok) refused++;
        else expect(latin1(r.bytes)).not.toContain("PhoneCo");
      }
    }
    expect(refused).toBeGreaterThan(0);
    for (const garbage of [
      new Uint8Array(0),
      Uint8Array.from([0xff, 0xd8]),
      Uint8Array.from([0xff, 0xd8, 0xff]),
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]),
      enc.encode("RIFF\xff\xff\xff\xffWEBP"),
      enc.encode("GIF89a"),
      new Uint8Array(1000).fill(0xff),
    ]) {
      const r = tryStripImageMetadata(garbage);
      expect(r.ok).toBe(false);
    }
  });

  it("refuses a JPEG with a readable header but no end of image, rather than passing it on unstripped", () => {
    const { bytes } = handJpeg(true);
    const cut = bytes.subarray(0, bytes.length - 2);
    expect(readImageDimensions(cut)).toEqual({ width: 64, height: 64 });
    const r = tryStripImageMetadata(cut);
    expect(r.ok).toBe(false);
  });
});
