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
 */
import { sniffImageMime } from "@/lib/image-validation";

export type MetadataReport = {
  format: "jpeg" | "png" | "webp" | null;
  hasExif: boolean;
  hasGps: boolean;
  hasXmp: boolean;
  hasOther: boolean;
  orientation: number | null;
};

export type StripResult = { bytes: Uint8Array; changed: boolean; report: MetadataReport };

const EMPTY: MetadataReport = {
  format: null,
  hasExif: false,
  hasGps: false,
  hasXmp: false,
  hasOther: false,
  orientation: null,
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

function stripJpeg(b: Uint8Array): StripResult {
  const report: MetadataReport = { ...EMPTY, format: "jpeg" };
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error("Not a JPEG");
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let changed = false;
  let keepOrientation: number | null = null;
  let sawEoi = false;
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
      out.push(b.subarray(i, j));
      i = j;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
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
    }
    if (drop) changed = true;
    else if (replacement) {
      out.push(replacement);
      if (!same(replacement, seg)) changed = true;
    } else out.push(seg);
    i += 2 + len;
  }
  if (!sawEoi) throw new Error("Truncated JPEG (no end of image)");
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
  while (i + 12 <= b.length) {
    const len = u32(b, i, false);
    const type = ascii(b, i + 4, 4);
    if (i + 12 + len > b.length) throw new Error("Malformed PNG chunk");
    if ((i === 8) !== (type === "IHDR"))
      throw new Error("Malformed PNG (IHDR must come first, once)");
    const chunk = b.subarray(i, i + 12 + len);
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
function filterAnmf(chunk: Uint8Array, size: number): Uint8Array {
  if (size < 16) throw new Error("Malformed WEBP frame");
  const body = chunk.subarray(8, 8 + size);
  const keep: Uint8Array[] = [body.subarray(0, 16)];
  let j = 16;
  let dropped = false;
  while (j + 8 <= body.length) {
    const t = ascii(body, j, 4);
    const sz = u32(body, j + 4, true);
    const end = j + 8 + sz + (sz & 1);
    if (end > body.length + 1) throw new Error("Malformed WEBP frame chunk");
    if (ANMF_KEEP.has(t)) keep.push(body.subarray(j, Math.min(end, body.length)));
    else dropped = true;
    j = end;
  }
  if (j < body.length) throw new Error("Truncated WEBP frame");
  if (!dropped) return chunk;
  const inner = concat(keep);
  const hdr = new Uint8Array(8);
  hdr.set(new TextEncoder().encode("ANMF"), 0);
  new DataView(hdr.buffer).setUint32(4, inner.length, true);
  return concat(inner.length & 1 ? [hdr, inner, new Uint8Array(1)] : [hdr, inner]);
}

function stripWebp(b: Uint8Array): StripResult {
  const report: MetadataReport = { ...EMPTY, format: "webp" };
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP")
    throw new Error("Not a WEBP");
  const parts: Uint8Array[] = [];
  let i = 12;
  let changed = false;
  let orientation: number | null = null;
  let vp8xAt = -1;
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
      if (type === "VP8X") vp8xAt = parts.length;
      if (type === "ANMF") {
        const frame = filterAnmf(chunk, size);
        if (frame !== chunk) {
          report.hasOther = true;
          changed = true;
          chunk = frame;
        }
      }
      parts.push(chunk);
    }
    i = end;
  }
  if (i < riffEnd) throw new Error("Truncated WEBP chunk");
  report.orientation = orientation;
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
