/**
 * Animated-image detection from the file's own bytes (audit F05). An animated PNG (APNG), an animated WEBP or a
 * multi-frame GIF carries frames a single-image safety scan never sees. Until a full-frame safety pipeline exists,
 * such files are refused wherever an image is stored as uploaded (chat attachments). The re-encoder keeps only the
 * first frame and publishes exactly what it scanned, so later frames never reach a reader there.
 *
 * Pure and dependency-free: it runs in the browser (early refusal) and on the server (the enforcement point).
 */

function ascii(b: Uint8Array, at: number, len: number) {
  let s = "";
  for (let i = 0; i < len && at + i < b.length; i++) s += String.fromCharCode(b[at + i]!);
  return s;
}
const be32 = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const le32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/** APNG: an `acTL` chunk anywhere before the image data (a reader treats a later one as plain PNG; refuse any). */
function apng(b: Uint8Array) {
  let at = 8; // after the 8-byte signature
  while (at + 8 <= b.length) {
    const len = be32(b, at);
    const type = ascii(b, at + 4, 4);
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return true;
    if (type === "IEND") return false;
    const next = at + 12 + len;
    if (next <= at) return true; // malformed length: treat as unsafe
    at = next;
  }
  return false;
}

/** WEBP: the VP8X animation flag, or ANIM / ANMF chunks. */
function animatedWebp(b: Uint8Array) {
  let at = 12; // after "RIFF" <size> "WEBP"
  while (at + 8 <= b.length) {
    const type = ascii(b, at, 4);
    const len = le32(b, at + 4);
    if (type === "VP8X" && at + 8 < b.length && (b[at + 8]! & 0x02) !== 0) return true;
    if (type === "ANIM" || type === "ANMF") return true;
    const next = at + 8 + len + (len & 1);
    if (next <= at) return true;
    at = next;
  }
  return false;
}

/** GIF: more than one image descriptor (0x2C) once extension blocks are skipped. */
function multiFrameGif(b: Uint8Array) {
  if (b.length < 13) return false;
  let at = 13;
  const flags = b[10]!;
  if (flags & 0x80) at += 3 * (1 << ((flags & 0x07) + 1)); // global colour table
  let frames = 0;
  const skipSubBlocks = () => {
    while (at < b.length) {
      const n = b[at]!;
      at += 1;
      if (n === 0) return;
      at += n;
    }
  };
  while (at < b.length) {
    const marker = b[at]!;
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      at += 2; // extension introducer + label
      skipSubBlocks();
    } else if (marker === 0x2c) {
      frames += 1;
      if (frames > 1) return true;
      const lflags = b[at + 9]!;
      at += 10;
      if (lflags & 0x80) at += 3 * (1 << ((lflags & 0x07) + 1)); // local colour table
      at += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      return false;
    }
  }
  return false;
}

/** True when the bytes are an animated (multi-frame) PNG, WEBP or GIF. */
export function isAnimatedImage(b: Uint8Array): boolean {
  if (b.length >= 8 && be32(b, 0) === 0x89504e47 && be32(b, 4) === 0x0d0a1a0a) return apng(b);
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP")
    return animatedWebp(b);
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF89a" || ascii(b, 0, 6) === "GIF87a"))
    return multiFrameGif(b);
  return false;
}
