/**
 * Shared (client + server) upload validation rules for user imagery.
 * Pure functions only — no Node or browser APIs.
 */

export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MIN_IMAGE_DIMENSION = 64; // px, either side
export const MAX_IMAGE_DIMENSION = 6000; // px, either side
export const MAX_IMAGE_PIXELS = 30_000_000; // guards decompression bombs

export type ImageDimensions = { width: number; height: number };

export function isAllowedImageMime(mime: string | null | undefined): mime is AllowedImageMime {
  return !!mime && (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime);
}

/** Human-friendly failure reason, or `null` when the file passes. */
export function validateImageMeta(input: {
  mime: string | null | undefined;
  bytes: number | null | undefined;
  dimensions?: ImageDimensions | null;
}): string | null {
  if (!isAllowedImageMime(input.mime)) {
    return "Only JPG, PNG or WEBP images are allowed";
  }
  if (!input.bytes || input.bytes <= 0) return "The file is empty";
  if (input.bytes > MAX_IMAGE_BYTES) return "Image is too large (max 8 MB)";

  const dim = input.dimensions;
  if (dim) {
    if (dim.width < MIN_IMAGE_DIMENSION || dim.height < MIN_IMAGE_DIMENSION) {
      return `Image is too small (min ${MIN_IMAGE_DIMENSION}×${MIN_IMAGE_DIMENSION}px)`;
    }
    if (dim.width > MAX_IMAGE_DIMENSION || dim.height > MAX_IMAGE_DIMENSION) {
      return `Image is too large (max ${MAX_IMAGE_DIMENSION}px per side)`;
    }
    if (dim.width * dim.height > MAX_IMAGE_PIXELS) {
      return "Image resolution is too high";
    }
  }
  return null;
}

/**
 * Read intrinsic dimensions straight from the file header for JPEG, PNG and
 * WEBP. Returns `null` when the bytes are not a recognisable image of that
 * type — callers should treat that as a validation failure.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return readPng(bytes) ?? readWebp(bytes) ?? readJpeg(bytes);
}

/** Sniff the real container type from magic bytes (defends against fake MIME). */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function ascii(b: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = offset; i < offset + length && i < b.length; i++) out += String.fromCharCode(b[i]!);
  return out;
}

function u16(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}

function u32(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}

function readPng(b: Uint8Array): ImageDimensions | null {
  if (sniffImageMime(b) !== "image/png" || b.length < 24) return null;
  return { width: u32(b, 16), height: u32(b, 20) };
}

function readJpeg(b: Uint8Array): ImageDimensions | null {
  if (sniffImageMime(b) !== "image/jpeg") return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = u16(b, i + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: u16(b, i + 5), width: u16(b, i + 7) };
    if (length <= 0) return null;
    i += 2 + length;
  }
  return null;
}

function readWebp(b: Uint8Array): ImageDimensions | null {
  if (sniffImageMime(b) !== "image/webp" || b.length < 30) return null;
  const format = ascii(b, 12, 4);
  if (format === "VP8X") {
    const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
    const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
    return { width: w, height: h };
  }
  if (format === "VP8 ") {
    return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  if (format === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
