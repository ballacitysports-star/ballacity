/** TEST SUPPORT ONLY: byte helpers and generated pictures shared by the image-runtime tests (same shapes as image-reencode tests). */
import sharp from "sharp";

export const enc = new TextEncoder();
export const PAYLOAD = enc.encode("HIDDEN-PAYLOAD::second-image::0123456789abcdef");

export const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) {
    o.set(x, k);
    k += x.length;
  }
  return o;
};
export const contains = (hay: Uint8Array, needle: Uint8Array) =>
  Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).indexOf(Buffer.from(needle)) >= 0;
export const be32 = (n: number) =>
  Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
export const le32 = (n: number) =>
  Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export const pchunk = (type: string, data: Uint8Array, badCrc = false) => {
  const body = cat(enc.encode(type), data);
  return cat(be32(data.length), body, be32(badCrc ? crc(body) ^ 1 : crc(body)));
};
export const wchunk = (type: string, data: Uint8Array) =>
  cat(
    enc.encode(type),
    le32(data.length),
    data,
    data.length & 1 ? new Uint8Array(1) : new Uint8Array(0),
  );
export const riff = (body: Uint8Array) =>
  cat(enc.encode("RIFF"), le32(4 + body.length), enc.encode("WEBP"), body);
export const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
export const solid = (w: number, h: number, colour: string) =>
  sharp({ create: { width: w, height: h, channels: 3, background: colour } });

/** Insert a JPEG APPn segment right after SOI. */
export function jpegWithSegment(jpeg: Uint8Array, marker: number, payload: Uint8Array): Uint8Array {
  const n = payload.length + 2;
  return cat(
    jpeg.subarray(0, 2),
    Uint8Array.from([0xff, marker, n >> 8, n & 255]),
    payload,
    jpeg.subarray(2),
  );
}

/** Insert a PNG chunk right after IHDR. */
export function pngWithChunk(png: Uint8Array, chunk: Uint8Array): Uint8Array {
  return cat(png.subarray(0, 33), chunk, png.subarray(33));
}

export async function meanAbsDiff(a: Uint8Array, b: Uint8Array) {
  const ra = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rb = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height)
    throw new Error(
      `size ${ra.info.width}x${ra.info.height} vs ${rb.info.width}x${rb.info.height}`,
    );
  let d = 0;
  for (let i = 0; i < ra.data.length; i++) d += Math.abs(ra.data[i] - rb.data[i]);
  return d / ra.data.length;
}

/** A gradient with real transparency: alpha runs 0..255 across, colour varies down. */
export async function alphaPng(w = 96, h = 80) {
  const raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[i] = (x * 7) & 255;
      raw[i + 1] = (y * 3) & 255;
      raw[i + 2] = 200;
      raw[i + 3] = Math.round((x / (w - 1)) * 255);
    }
  return u8(
    await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer(),
  );
}

/** 64x64 RGBA: left half opaque grey ramp, right half an RGB gradient (the hidden picture) at `alpha`. */
export const HIDDEN_W = 64;
export function hiddenAlphaPixels(alpha: number): Buffer {
  const W = HIDDEN_W;
  const px = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (x < W / 2) {
        px[i] = px[i + 1] = px[i + 2] = (x * 7 + y) & 255;
        px[i + 3] = 255;
      } else {
        px[i] = (x * 4) & 255;
        px[i + 1] = (y * 4) & 255;
        px[i + 2] = (x * y) & 255;
        px[i + 3] = alpha;
      }
    }
  return px;
}
export async function hiddenAlphaImage(alpha: number, format: "png" | "webp") {
  const s = sharp(hiddenAlphaPixels(alpha), {
    raw: { width: HIDDEN_W, height: HIDDEN_W, channels: 4 },
  });
  // exact: true keeps the hidden RGB, as a hostile uploader's encoder would.
  return u8(
    await (format === "png" ? s.png() : s.webp({ lossless: true, exact: true })).toBuffer(),
  );
}

/** A left stripe on a 120x80 card, stored with the given EXIF orientation. */
export async function orientedCard(orientation: number, fmt: "jpeg" | "png" | "webp") {
  const raw = Buffer.alloc(120 * 80 * 3);
  for (let i = 0; i < raw.length; i += 3) {
    const x = (i / 3) % 120;
    const y = Math.floor(i / 3 / 120);
    raw[i] = x < 30 ? 255 : 0;
    raw[i + 1] = y < 20 ? 255 : 0;
  }
  const base = sharp(raw, { raw: { width: 120, height: 80, channels: 3 } });
  return u8(
    await (
      fmt === "jpeg"
        ? base.jpeg({ quality: 100 })
        : fmt === "png"
          ? base.png()
          : base.webp({ lossless: true })
    )
      .withMetadata({ orientation })
      .toBuffer(),
  );
}
