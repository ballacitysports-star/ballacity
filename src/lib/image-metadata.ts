/**
 * Remove location and other personal metadata from an uploaded image, server side.
 *
 * Phones write the GPS position, device, time and sometimes the owner into JPEG/PNG/WEBP files. A photo of a youth game,
 * a team or a facility would otherwise publish where it was taken. The browser cannot be trusted to remove it (a
 * direct upload skips the client), so the server strips it from the stored bytes before the image is used.
 *
 * The bytes are rewritten, never decoded or re-encoded, so the picture is identical and nothing is lost to compression.
 * What is kept: everything needed to draw the image (pixel data, palette, transparency, gamma, ICC colour profile,
 * animation chunks) and the EXIF Orientation tag alone, because without it a phone photo displays sideways. What is
 * removed: EXIF (GPS, camera, timestamps, thumbnails), XMP, IPTC/Photoshop blocks, comments and text chunks, the PNG
 * modification time, and unknown ancillary data. Pure functions, no Node or browser APIs, so it runs on the server and in tests.
 *
 * Structured segments are checked against their spec length: a fixed-size segment or chunk (JPEG SOF/SOS/DRI/DNL, PNG pHYs,
 * sRGB, gAMA, cHRM, bKGD, sBIT, tRNS, IEND, ..., WEBP VP8X/ANIM) is copied at exactly its spec length (extra bytes, which can
 * carry anything, are cut and reported as hasOther) or refused/dropped when too short; JPEG Huffman and quantisation tables must
 * fill their segment exactly. A file with no image data (no JPEG scan, no PNG IDAT, no WEBP VP8/VP8L) is refused.
 * RESIDUAL (documented in docs/privacy/g3b-image-staging.md): the ICC profile is kept byte for byte (its description and
 * copyright text and any private tags survive; rewriting it would change every real phone photo), and pixel/table data itself
 * can of course encode anything a picture can.
 */
import { sniffImageMime } from "@/lib/image-validation";

export type MetadataReport = {
  format: "jpeg" | "png" | "webp" | null;
  hasExif: boolean;
  hasGps: boolean;
  hasXmp: boolean;
  hasOther: boolean;
  orientation: number | null;
  /** APNG (a valid acTL) or animated WEBP (ANIM/ANMF or the VP8X animation flag). A single-frame scan does not see every frame. */
  animated: boolean;
};

export type StripResult = { bytes: Uint8Array; changed: boolean; report: MetadataReport };

const EMPTY: MetadataReport = {
  format: null,
  hasExif: false,
  hasGps: false,
  hasXmp: false,
  hasOther: false,
  orientation: null,
  animated: false,
};

const u16 = (b: Uint8Array, o: number, le: boolean) =>
  le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number, le: boolean) =>
  (le
    ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
    : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** Read Orientation (0x0112) and the presence of the GPS pointer (0x8825) from a TIFF block. */
function readTiff(tiff: Uint8Array): { orientation: number | null; gps: boolean } {
  if (tiff.length < 8) return { orientation: null, gps: false };
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return { orientation: null, gps: false };
  if (u16(tiff, 2, le) !== 42) return { orientation: null, gps: false };
  const ifd = u32(tiff, 4, le);
  if (ifd + 2 > tiff.length) return { orientation: null, gps: false };
  const n = u16(tiff, ifd, le);
  let orientation: number | null = null;
  let gps = false;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) break;
    const tag = u16(tiff, e, le);
    if (tag === 0x0112) {
      const v = u16(tiff, e + 8, le);
      if (v >= 1 && v <= 8) orientation = v;
    } else if (tag === 0x8825) gps = true;
  }
  return { orientation, gps };
}

/** A TIFF block that carries nothing but the Orientation tag (big endian). */
function orientationTiff(orientation: number): Uint8Array {
  return Uint8Array.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // header, IFD0 at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00, // Orientation, SHORT
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ]);
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- JPEG
/** Segments needed to decode: SOFn (C0-CF except C4 DHT, C8 reserved, CC DAC — those two tables are kept too), DQT, DNL, DRI. */
const JPEG_KEEP = (m: number) =>
  (m >= 0xc0 && m <= 0xcf && m !== 0xc8) || m === 0xdb || m === 0xdc || m === 0xdd;
const JPEG_SOF = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** The payload length a kept JPEG segment must have (null: variable, validated by walking it). Throws when it cannot be valid. */
function jpegSpecLength(m: number, payload: Uint8Array): number | null {
  if (JPEG_SOF(m)) {
    // P, Y, X, Nf, then 3 bytes per component
    if (payload.length < 6 || payload[5] < 1) throw new Error("Malformed JPEG frame header");
    return 6 + 3 * payload[5];
  }
  if (m === 0xdd || m === 0xdc) return 2; // DRI (Ri), DNL (NL)
  if (m === 0xdb) {
    // DQT: one or more tables of Pq/Tq + 64 (8-bit) or 128 (16-bit) bytes, filling the segment exactly
    let j = 0;
    while (j < payload.length) {
      const pq = payload[j] >> 4;
      if (pq > 1 || (payload[j] & 0x0f) > 3) throw new Error("Malformed JPEG quantisation table");
      j += 1 + (pq ? 128 : 64);
    }
    if (j !== payload.length || j === 0) throw new Error("Malformed JPEG quantisation table");
    return null;
  }
  if (m === 0xc4) {
    // DHT: one or more tables of Tc/Th + 16 code counts + that many symbols, filling the segment exactly
    let j = 0;
    while (j < payload.length) {
      if (payload[j] >> 4 > 1 || (payload[j] & 0x0f) > 3 || j + 17 > payload.length)
        throw new Error("Malformed JPEG Huffman table");
      let n = 0;
      for (let k = 1; k <= 16; k++) n += payload[j + k];
      if (n > 256) throw new Error("Malformed JPEG Huffman table");
      j += 17 + n;
    }
    if (j !== payload.length || j === 0) throw new Error("Malformed JPEG Huffman table");
    return null;
  }
  if (m === 0xcc) {
    if (payload.length === 0 || payload.length % 2) throw new Error("Malformed JPEG DAC segment");
    return null;
  }
  return null;
}

/** A segment rewritten with only its first `n` payload bytes. */
const jpegSegment = (m: number, payload: Uint8Array, n: number) =>
  concat([Uint8Array.from([0xff, m, (n + 2) >> 8, (n + 2) & 0xff]), payload.subarray(0, n)]);

function stripJpeg(b: Uint8Array): StripResult {
  const report: MetadataReport = { ...EMPTY, format: "jpeg" };
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error("Not a JPEG");
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let changed = false;
  let keepOrientation: number | null = null;
  let sawEoi = false;
  let sawFrame = false;
  let sawScan = false;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error("Malformed JPEG");
    let m = b[i + 1];
    while (m === 0xff) m = b[++i + 1]; // fill bytes
    if (m === 0xd9) {
      out.push(b.subarray(i, i + 2)); // EOI
      if (i + 2 < b.length) changed = true; // anything after EOI (secondary images, motion-photo video, appended data) is dropped
      sawEoi = true;
      i = b.length;
      break;
    }
    if (m === 0xda) {
      // SOS: keep the scan header, then walk the entropy-coded data to the next real marker, so metadata placed between scans
      // (progressive files) and everything after EOI are handled by the same rules as the header segments.
      if (i + 4 > b.length) throw new Error("Truncated JPEG");
      const slen = (b[i + 2] << 8) | b[i + 3];
      if (slen < 2 || i + 2 + slen > b.length) throw new Error("Malformed JPEG segment");
      // The scan header has a spec length of 4 + 2 * Ns payload bytes (Ns components, then Ss, Se, Ah/Al); extra bytes are cut.
      const ns = slen > 2 ? b[i + 4] : 0;
      if (ns < 1 || ns > 4 || slen - 2 < 4 + 2 * ns || !sawFrame)
        throw new Error("Malformed JPEG scan header");
      const header =
        slen - 2 === 4 + 2 * ns
          ? b.subarray(i, i + 2 + slen)
          : jpegSegment(0xda, b.subarray(i + 4, i + 2 + slen), 4 + 2 * ns);
      if (header.length !== 2 + slen) {
        changed = true;
        report.hasOther = true;
      }
      sawScan = true;
      let j = i + 2 + slen;
      while (j < b.length) {
        if (b[j] === 0xff) {
          const n = b[j + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            j += 2;
            continue;
          }
          if (n === 0xff) {
            j += 1;
            continue;
          }
          break; // a real marker
        }
        j += 1;
      }
      out.push(header, b.subarray(i + 2 + slen, j));
      i = j;
      continue;
    }
    if (m === 0xd8) throw new Error("Malformed JPEG (a second start of image)");
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) throw new Error("Truncated JPEG");
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new Error("Malformed JPEG segment");
    const seg = b.subarray(i, i + 2 + len);
    const payload = b.subarray(i + 4, i + 2 + len);
    let drop = false;
    let replacement: Uint8Array | null = null;
    if (m === 0xe0) {
      // APP0: keep only the 14-byte JFIF header with its thumbnail size set to 0 x 0; JFIF thumbnails and JFXX/other APP0
      // extensions are dropped (a thumbnail can show the original, uncropped picture).
      if (len >= 16 && ascii(payload, 0, 5) === "JFIF\0") {
        const jfif = payload.slice(0, 14);
        jfif[12] = 0;
        jfif[13] = 0;
        replacement = concat([Uint8Array.from([0xff, 0xe0, 0x00, 0x10]), jfif]);
        if (len !== 16 || payload[12] !== 0 || payload[13] !== 0) report.hasOther = true;
      } else {
        drop = true;
        report.hasOther = true;
      }
    } else if (m === 0xee) {
      // APP14: keep only the 12-byte Adobe colour-transform header; anything after it, or a non-Adobe APP14, is dropped.
      if (len >= 14 && ascii(payload, 0, 5) === "Adobe") {
        replacement = concat([Uint8Array.from([0xff, 0xee, 0x00, 0x0e]), payload.slice(0, 12)]);
        if (len !== 14) report.hasOther = true;
      } else {
        drop = true;
        report.hasOther = true;
      }
    } else if (m === 0xe1) {
      drop = true;
      if (ascii(payload, 0, 6) === "Exif\0\0") {
        report.hasExif = true;
        const t = readTiff(payload.subarray(6));
        if (t.gps) report.hasGps = true;
        if (t.orientation) keepOrientation = t.orientation;
      } else {
        report.hasXmp = true;
      }
    } else if (m === 0xed || m === 0xfe || (m >= 0xe3 && m <= 0xef && m !== 0xee)) {
      drop = true;
      report.hasOther = true; // Photoshop/IPTC, comments, vendor blocks (APP14 Adobe is kept: it sets the colour transform)
    } else if (m === 0xe2) {
      if (ascii(payload, 0, 12) !== "ICC_PROFILE\0") {
        drop = true;
        report.hasOther = true; // FlashPix and other APP2 data; the ICC profile is kept
      }
    } else if (!JPEG_KEEP(m)) {
      // allow-list: anything that is not a frame, table or restart definition (JPGn extensions, reserved markers) is dropped
      drop = true;
      report.hasOther = true;
    } else {
      // a kept structural segment: copied at its spec length (extra bytes are cut), refused when too short or malformed
      const spec = jpegSpecLength(m, payload);
      if (JPEG_SOF(m)) sawFrame = true;
      if (spec !== null) {
        if (payload.length < spec) throw new Error("Malformed JPEG segment (too short)");
        if (payload.length > spec) {
          replacement = jpegSegment(m, payload, spec);
          report.hasOther = true;
        }
      }
    }
    if (drop) changed = true;
    else if (replacement) {
      out.push(replacement);
      if (!same(replacement, seg)) changed = true;
    } else out.push(seg);
    i += 2 + len;
  }
  if (!sawEoi) throw new Error("Truncated JPEG (no end of image)");
  if (!sawScan) throw new Error("JPEG has no image data");
  report.orientation = keepOrientation;
  if (keepOrientation && keepOrientation !== 1) {
    const tiff = orientationTiff(keepOrientation);
    const len = 2 + 6 + tiff.length;
    const seg = concat([
      Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff]),
      new TextEncoder().encode("Exif\0\0"),
      tiff,
    ]);
    // after SOI and any JFIF APP0, before the rest
    const insertAt = out.length > 1 && out[1][1] === 0xe0 ? 2 : 1;
    out.splice(insertAt, 0, seg);
    changed = true;
  }
  if (!changed) return { bytes: b, changed: false, report };
  const result = concat(out);
  // Re-running on our own output rewrites the same orientation-only block: that is not a change.
  return same(result, b)
    ? { bytes: b, changed: false, report }
    : { bytes: result, changed: true, report };
}

// ------------------------------------------------------------------------------------------------ PNG
let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([new TextEncoder().encode(type), data]);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(body, 4);
  dv.setUint32(8 + data.length, crc32(body));
  return out;
}

const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "bKGD",
  "hIST",
  "pHYs",
  "acTL",
  "fcTL",
  "fdAT",
  "cICP",
  "mDCV",
  "cLLI",
]);

/** Fixed payload lengths of kept PNG chunks; tRNS/bKGD/sBIT/hIST depend on the colour type and palette (see pngSpecLength). */
const PNG_FIXED: Record<string, number> = {
  IEND: 0,
  gAMA: 4,
  cHRM: 32,
  sRGB: 1,
  pHYs: 9,
  acTL: 8,
  fcTL: 26,
  cICP: 4,
  cLLI: 8,
  mDCV: 24,
};

/** The spec length of a kept chunk, or -1 for "not allowed here" (dropped), or null for variable-length data. */
function pngSpecLength(type: string, colorType: number, paletteEntries: number): number | null {
  if (type in PNG_FIXED) return PNG_FIXED[type];
  if (type === "bKGD") return colorType === 3 ? 1 : colorType === 0 || colorType === 4 ? 2 : 6;
  if (type === "sBIT") return [1, -1, 3, 3, 2, -1, 4][colorType] ?? -1;
  if (type === "hIST") return paletteEntries > 0 ? 2 * paletteEntries : -1;
  if (type === "tRNS") {
    if (colorType === 0) return 2;
    if (colorType === 2) return 6;
    return -1; // palette tRNS is variable (checked by the caller); colour types with an alpha channel may not have one
  }
  return null;
}

function stripPng(b: Uint8Array): StripResult {
  const report: MetadataReport = { ...EMPTY, format: "png" };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, k) => b[k] !== v)) throw new Error("Not a PNG");
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let changed = false;
  let orientation: number | null = null;
  let ihdrEnd = -1;
  let sawIend = false;
  let colorType = -1;
  let paletteEntries = 0;
  let sawIdat = false;
  let actl = false; // a valid acTL (before the first IDAT) makes this an APNG; without one, fcTL/fdAT are dropped
  while (i + 12 <= b.length) {
    const len = u32(b, i, false);
    const type = ascii(b, i + 4, 4);
    if (i + 12 + len > b.length) throw new Error("Malformed PNG chunk");
    if ((i === 8) !== (type === "IHDR"))
      throw new Error("Malformed PNG (IHDR must come first, once)");
    let chunk = b.subarray(i, i + 12 + len);
    const data = b.subarray(i + 8, i + 8 + len);
    let spec = PNG_KEEP.has(type) ? pngSpecLength(type, colorType, paletteEntries) : null;
    if (type === "tRNS" && colorType === 3) spec = len >= 1 && len <= paletteEntries ? len : -1;
    if (type === "IHDR") {
      if (len !== 13 || ![0, 2, 3, 4, 6].includes(data[9])) throw new Error("Malformed PNG header");
      colorType = data[9];
    } else if (type === "PLTE") {
      if (len === 0 || len % 3 || len > 768 || paletteEntries)
        throw new Error("Malformed PNG palette");
      paletteEntries = len / 3;
    } else if (type === "IDAT") sawIdat = true;
    if (type === "acTL" && !sawIdat && !actl) {
      actl = true;
    } else if (type === "acTL" || ((type === "fcTL" || type === "fdAT") && !actl)) {
      spec = -1; // a second or late acTL, or frame chunks in a file that is not an APNG: not part of the still image
    }
    if (spec !== null && spec !== len && PNG_KEEP.has(type)) {
      if (type === "IEND") {
        chunk = pngChunk("IEND", new Uint8Array(0));
      } else if (spec < 0 || len < spec) {
        report.hasOther = true; // an ancillary chunk that is not allowed here, or too short to be valid, is dropped
        changed = true;
        i += 12 + len;
        continue;
      } else {
        chunk = pngChunk(type, data.subarray(0, spec)); // copied at its spec length; the extra bytes are cut
      }
      report.hasOther = true;
      changed = true;
    }
    if (type === "eXIf") {
      report.hasExif = true;
      const t = readTiff(b.subarray(i + 8, i + 8 + len));
      if (t.gps) report.hasGps = true;
      if (t.orientation) orientation = t.orientation;
      changed = true;
    } else if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      report.hasOther = true;
      const keyword = ascii(b, i + 8, Math.min(len, 20)).toLowerCase();
      if (keyword.includes("xml:com.adobe.xmp")) report.hasXmp = true;
      changed = true;
    } else if (!PNG_KEEP.has(type)) {
      // unknown or metadata chunk (tIME, vendor ancillary data); critical chunks (uppercase first letter) are always kept
      if (type.charCodeAt(0) >= 0x61) {
        report.hasOther = true;
        changed = true;
      } else throw new Error(`Unsupported critical PNG chunk ${JSON.stringify(type)}`); // cannot be dropped, so cannot be published
    } else {
      out.push(chunk);
      if (type === "IHDR") ihdrEnd = out.length;
    }
    i += 12 + len;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend) throw new Error("Truncated PNG (no IEND)");
  if (!sawIdat) throw new Error("PNG has no image data");
  if (colorType === 3 && !paletteEntries)
    throw new Error("Malformed PNG (palette image without PLTE)");
  report.animated = actl;
  if (i < b.length) {
    report.hasOther = true; // data appended after IEND is dropped
    changed = true;
  }
  report.orientation = orientation;
  if (orientation && orientation !== 1 && ihdrEnd > 0) {
    out.splice(ihdrEnd, 0, pngChunk("eXIf", orientationTiff(orientation)));
    changed = true;
  }
  if (!changed) return { bytes: b, changed: false, report };
  const result = concat(out);
  return same(result, b)
    ? { bytes: b, changed: false, report }
    : { bytes: result, changed: true, report };
}

// ----------------------------------------------------------------------------------------------- WEBP
const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);
const ANMF_KEEP = new Set(["VP8 ", "VP8L", "ALPH"]);

/** Keep only image sub-chunks inside an animation frame (16-byte frame header, then sub-chunks). */
function filterAnmf(chunk: Uint8Array, size: number): { frame: Uint8Array; hasImage: boolean } {
  if (size < 16) throw new Error("Malformed WEBP frame");
  const body = chunk.subarray(8, 8 + size);
  const keep: Uint8Array[] = [body.subarray(0, 16)];
  let j = 16;
  let dropped = false;
  let hasImage = false;
  while (j + 8 <= body.length) {
    const t = ascii(body, j, 4);
    const sz = u32(body, j + 4, true);
    const end = j + 8 + sz + (sz & 1);
    if (end > body.length + 1) throw new Error("Malformed WEBP frame chunk");
    if (ANMF_KEEP.has(t)) keep.push(body.subarray(j, Math.min(end, body.length)));
    else dropped = true;
    if (t === "VP8 " || t === "VP8L") hasImage = true;
    j = end;
  }
  if (j < body.length) throw new Error("Truncated WEBP frame");
  if (!dropped) return { frame: chunk, hasImage };
  const inner = concat(keep);
  const hdr = new Uint8Array(8);
  hdr.set(new TextEncoder().encode("ANMF"), 0);
  new DataView(hdr.buffer).setUint32(4, inner.length, true);
  return {
    frame: concat(inner.length & 1 ? [hdr, inner, new Uint8Array(1)] : [hdr, inner]),
    hasImage,
  };
}

/** A WEBP chunk rewritten with only its first `n` payload bytes (n even, so no pad byte). */
function webpChunk(type: string, data: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(8 + n);
  out.set(new TextEncoder().encode(type), 0);
  new DataView(out.buffer).setUint32(4, n, true);
  out.set(data.subarray(0, n), 8);
  return out;
}

const WEBP_FIXED: Record<string, number> = { VP8X: 10, ANIM: 6 };

function stripWebp(b: Uint8Array): StripResult {
  const report: MetadataReport = { ...EMPTY, format: "webp" };
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP")
    throw new Error("Not a WEBP");
  const parts: Uint8Array[] = [];
  let i = 12;
  let changed = false;
  let orientation: number | null = null;
  let vp8xAt = -1;
  let hasImage = false;
  let animated = false;
  const riffEnd = Math.min(8 + u32(b, 4, true), b.length);
  if (riffEnd < b.length) {
    report.hasOther = true; // data appended after the RIFF container is dropped
    changed = true;
  }
  while (i + 8 <= riffEnd) {
    const type = ascii(b, i, 4);
    const size = u32(b, i + 4, true);
    const padded = size + (size & 1);
    if (i + 8 + padded > riffEnd + 1) throw new Error("Malformed WEBP chunk");
    const end = Math.min(i + 8 + padded, riffEnd);
    let chunk = b.subarray(i, end);
    if (type === "EXIF") {
      report.hasExif = true;
      let tiff = b.subarray(i + 8, i + 8 + size);
      if (ascii(tiff, 0, 6) === "Exif\0\0") tiff = tiff.subarray(6);
      const t = readTiff(tiff);
      if (t.gps) report.hasGps = true;
      if (t.orientation) orientation = t.orientation;
      changed = true;
    } else if (type === "XMP ") {
      report.hasXmp = true;
      changed = true;
    } else if (!WEBP_KEEP.has(type)) {
      report.hasOther = true; // allow-list: unknown chunks are dropped
      changed = true;
    } else {
      const spec = WEBP_FIXED[type];
      if (spec !== undefined && size !== spec) {
        if (size < spec) throw new Error(`Malformed WEBP ${type} chunk`);
        chunk = webpChunk(type, b.subarray(i + 8, i + 8 + size), spec); // copied at its spec length; extra bytes are cut
        report.hasOther = true;
        changed = true;
      }
      if (type === "VP8X") {
        vp8xAt = parts.length;
        // only the defined flags (ICC, alpha, EXIF, XMP, animation) and the canvas size; reserved bits and bytes are zeroed
        if ((chunk[8] & ~0x3e) !== 0 || chunk[9] || chunk[10] || chunk[11]) {
          chunk = chunk.slice();
          chunk[8] &= 0x3e;
          chunk[9] = chunk[10] = chunk[11] = 0;
          report.hasOther = true;
          changed = true;
        }
        if (chunk[8] & 0x02) animated = true;
      }
      if (type === "VP8 " || type === "VP8L") hasImage = true;
      if (type === "ANIM") animated = true;
      if (type === "ANMF") {
        animated = true;
        const f = filterAnmf(chunk, size);
        if (f.hasImage) hasImage = true;
        if (f.frame !== chunk) {
          report.hasOther = true;
          changed = true;
          chunk = f.frame;
        }
      }
      parts.push(chunk);
    }
    i = end;
  }
  if (i < riffEnd) throw new Error("Truncated WEBP chunk");
  if (!hasImage) throw new Error("WEBP has no image data");
  report.orientation = orientation;
  report.animated = animated;
  const keepExif = !!orientation && orientation !== 1 && vp8xAt >= 0;
  if (keepExif) {
    const tiff = orientationTiff(orientation as number);
    const hdr = new Uint8Array(8);
    hdr.set(new TextEncoder().encode("EXIF"), 0);
    new DataView(hdr.buffer).setUint32(4, tiff.length, true);
    parts.push(concat([hdr, tiff]));
    changed = true;
  }
  if (!changed) return { bytes: b, changed: false, report };
  if (vp8xAt >= 0) {
    const vp8x = parts[vp8xAt].slice();
    vp8x[8] = keepExif ? (vp8x[8] | 0x08) & ~0x04 : vp8x[8] & ~0x0c; // EXIF flag, XMP flag
    parts[vp8xAt] = vp8x;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(new TextEncoder().encode("WEBP"), 8);
  out.set(body, 12);
  return same(out, b)
    ? { bytes: b, changed: false, report }
    : { bytes: out, changed: true, report };
}

/** Look at an image without changing it. */
export function inspectImageMetadata(bytes: Uint8Array): MetadataReport {
  return stripImageMetadata(bytes).report;
}

/**
 * Rewrite a JPEG, PNG or WEBP without personal metadata (see the file header). `changed` is false, and the very same
 * array is returned, when there was nothing to remove. Throws on a file that is not a well-formed image of its type;
 * the caller must treat that as "do not publish".
 */
export function stripImageMetadata(bytes: Uint8Array): StripResult {
  const mime = sniffImageMime(bytes);
  if (mime === "image/jpeg") return stripJpeg(bytes);
  if (mime === "image/png") return stripPng(bytes);
  if (mime === "image/webp") return stripWebp(bytes);
  throw new Error("Not a JPG, PNG or WEBP image");
}

/** True when the report shows anything that could identify a person or place. */
export function hasPersonalMetadata(r: MetadataReport): boolean {
  return r.hasGps || r.hasXmp || r.hasOther || r.hasExif;
}
