/**
 * A minimal, pure-JS PNG decoder and encoder for the Workers runtime (no native code, no WASM).
 *
 * WHY. The Cloudflare Images binding never hands back pixels in a documented way (only encoded files), so the colour hidden under
 * transparent pixels (final review 780eaf8f, finding 1) cannot be quantised inside the platform. The PoC asks the binding for a PNG
 * (decoded, oriented and converted to sRGB by Cloudflare), decodes it here, quantises the hidden colour, and writes a new PNG whose
 * container is entirely ours: IHDR, IDAT, IEND, nothing else. See src/lib/image-runtime/cloudflare-images.server.ts.
 *
 * Scope: non-interlaced PNG, colour types 0/2/4/6 at 8 or 16 bits and palette (type 3) at 1/2/4/8 bits, with tRNS. Anything
 * else (Adam7 interlace, sub-byte grey, bad CRCs, missing or extra image data) is refused: the caller fails closed.
 * Compression uses the platform's CompressionStream("deflate") (zlib, available in Workers and Node 18+). Output is
 * deterministic for a given input and zlib build: fixed filter heuristic, fixed IDAT split, no timestamps or text.
 *
 * MEMORY. Decoding holds one RGBA frame (width x height x 4 bytes) plus two scanlines; encoding streams scanlines into the
 * compressor and holds only the compressed output. The caller must cap the pixel count before calling (the Worker isolate has
 * 128 MB, and a 30 MP RGBA frame alone is 120 MB).
 */

export class PngCodecError extends Error {
  readonly kind: "malformed" | "too_large";
  constructor(kind: "malformed" | "too_large", message: string) {
    super(message);
    this.name = "PngCodecError";
    this.kind = kind;
  }
}

export type RgbaImage = { width: number; height: number; data: Uint8Array };

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts)
    for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const ascii = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Channels per colour type, and whether the combination of type and depth is one this decoder reads. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function supported(colourType: number, depth: number): boolean {
  if (colourType === 3) return depth === 1 || depth === 2 || depth === 4 || depth === 8;
  return colourType in CHANNELS && (depth === 8 || depth === 16);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Read the PNG header only (no inflation): dimensions, colour type, depth, interlace. */
export function readPngHeader(
  bytes: Uint8Array,
): { width: number; height: number; colourType: number; depth: number; interlace: number } | null {
  if (bytes.length < 33) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  if (be32(bytes, 8) !== 13 || ascii(bytes, 12) !== "IHDR") return null;
  return {
    width: be32(bytes, 16),
    height: be32(bytes, 20),
    depth: bytes[24],
    colourType: bytes[25],
    interlace: bytes[28],
  };
}

/**
 * Decode a PNG to 8-bit RGBA. Refuses (PngCodecError "too_large") before inflating when width x height exceeds `maxPixels`,
 * and refuses ("malformed") on any structural problem, a bad CRC, or image data that is shorter or longer than the header says.
 */
export async function decodePngToRgba(
  bytes: Uint8Array,
  options: { maxPixels: number },
): Promise<RgbaImage> {
  const header = readPngHeader(bytes);
  if (!header) throw new PngCodecError("malformed", "not a PNG");
  const { width, height, colourType, depth, interlace } = header;
  if (!width || !height) throw new PngCodecError("malformed", "empty image");
  if (width * height > options.maxPixels) throw new PngCodecError("too_large", "pixel cap");
  if (bytes[26] !== 0 || bytes[27] !== 0) throw new PngCodecError("malformed", "compression");
  if (interlace !== 0) throw new PngCodecError("malformed", "interlaced PNG is not supported");
  if (!supported(colourType, depth)) throw new PngCodecError("malformed", "unsupported layout");

  // Walk the chunks: CRCs checked, PLTE/tRNS kept, IDAT collected in order, IEND required.
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let ended = false;
  let idatClosed = false;
  for (let i = 8; i + 12 <= bytes.length;) {
    const len = be32(bytes, i);
    const type = ascii(bytes, i + 4);
    if (i + 12 + len > bytes.length) throw new PngCodecError("malformed", "truncated chunk");
    const typeBytes = bytes.subarray(i + 4, i + 8);
    const data = bytes.subarray(i + 8, i + 8 + len);
    if (crc32([typeBytes, data]) !== be32(bytes, i + 8 + len))
      throw new PngCodecError("malformed", `bad CRC in ${type}`);
    if (type === "IDAT") {
      if (idatClosed) throw new PngCodecError("malformed", "IDAT not contiguous");
      idat.push(data);
    } else {
      if (idat.length) idatClosed = true;
      if (type === "PLTE") palette = data;
      else if (type === "tRNS") trns = data;
      else if (type === "IEND") {
        ended = true;
        break;
      } else if ((type.charCodeAt(0) & 0x20) === 0 && type !== "IHDR") {
        throw new PngCodecError("malformed", `unknown critical chunk ${type}`);
      }
    }
    i += 12 + len;
  }
  if (!ended || !idat.length) throw new PngCodecError("malformed", "no image data or no IEND");
  if (colourType === 3 && (!palette || palette.length % 3 !== 0))
    throw new PngCodecError("malformed", "palette");

  const channels = CHANNELS[colourType];
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let filter = -1;
  let filled = 0;
  let y = 0;

  const key16 =
    trns && (colourType === 0 || colourType === 2)
      ? Array.from(
          { length: colourType === 0 ? 1 : 3 },
          (_, k) => (trns![2 * k] << 8) | trns![2 * k + 1],
        )
      : null;

  const emitRow = () => {
    // Unfilter in place against the previous (already unfiltered) row.
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < stride; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255;
        break;
      case 2:
        for (let i = 0; i < stride; i++) cur[i] = (cur[i] + prev[i]) & 255;
        break;
      case 3:
        for (let i = 0; i < stride; i++)
          cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255;
        break;
      case 4:
        for (let i = 0; i < stride; i++)
          cur[i] =
            (cur[i] + paeth(i >= bpp ? cur[i - bpp] : 0, prev[i], i >= bpp ? prev[i - bpp] : 0)) &
            255;
        break;
      default:
        throw new PngCodecError("malformed", "bad filter type");
    }
    // Convert the scanline to RGBA8.
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      let r: number, g: number, b: number, a: number;
      if (colourType === 3) {
        const bit = x * depth;
        const idx = (cur[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        if (idx * 3 + 2 >= palette!.length) throw new PngCodecError("malformed", "palette index");
        r = palette![idx * 3];
        g = palette![idx * 3 + 1];
        b = palette![idx * 3 + 2];
        a = trns && idx < trns.length ? trns[idx] : 255;
      } else if (depth === 8) {
        const p = x * channels;
        if (channels <= 2) {
          r = g = b = cur[p];
          a = channels === 2 ? cur[p + 1] : key16 && cur[p] === key16[0] ? 0 : 255;
        } else {
          r = cur[p];
          g = cur[p + 1];
          b = cur[p + 2];
          a =
            channels === 4
              ? cur[p + 3]
              : key16 && r === key16[0] && g === key16[1] && b === key16[2]
                ? 0
                : 255;
        }
      } else {
        // 16-bit: keep the high byte (the colour key is compared at full precision).
        const p = x * channels * 2;
        const s = (k: number) => (cur[p + 2 * k] << 8) | cur[p + 2 * k + 1];
        if (channels <= 2) {
          r = g = b = cur[p];
          a = channels === 2 ? cur[p + 2] : key16 && s(0) === key16[0] ? 0 : 255;
        } else {
          r = cur[p];
          g = cur[p + 2];
          b = cur[p + 4];
          a =
            channels === 4
              ? cur[p + 6]
              : key16 && s(0) === key16[0] && s(1) === key16[1] && s(2) === key16[2]
                ? 0
                : 255;
        }
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
    const t = prev;
    prev = cur;
    cur = t;
    filter = -1;
    filled = 0;
    y += 1;
  };

  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  const pump = (async () => {
    for (const part of idat) await writer.write(part as Uint8Array<ArrayBuffer>);
    await writer.close();
  })().catch(() => undefined);
  const reader = ds.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length;) {
        if (y >= height)
          throw new PngCodecError("malformed", "more image data than the header says");
        if (filter < 0) {
          filter = value[i++];
          continue;
        }
        const n = Math.min(stride - filled, value.length - i);
        cur.set(value.subarray(i, i + n), filled);
        filled += n;
        i += n;
        if (filled === stride) emitRow();
      }
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    if (e instanceof PngCodecError) throw e;
    throw new PngCodecError("malformed", `inflate: ${String((e as Error)?.message ?? e)}`);
  } finally {
    await pump;
  }
  if (y !== height || filter >= 0) throw new PngCodecError("malformed", "image data is short");
  return { width, height, data: out };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32([out.subarray(4, 8), data]));
  return out;
}

/** Largest IDAT payload written (fixed, so the container layout is deterministic). */
const IDAT_MAX = 1 << 20;
/** Scanlines are handed to the compressor in batches of about this many bytes. */
const BATCH = 1 << 16;

/**
 * Encode 8-bit RGBA pixels as a new PNG: RGBA (colour type 6) when `channels` is 4, RGB (type 2) when 3 (the alpha byte of
 * each pixel is then skipped). The file holds IHDR, IDAT and IEND only. Per-row filter chosen by the minimum sum of absolute
 * differences (the libpng heuristic), so the same pixels always give the same bytes.
 */
export async function encodePngFromRgba(image: RgbaImage, channels: 3 | 4): Promise<Uint8Array> {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) throw new PngCodecError("malformed", "pixel buffer size");
  const stride = width * channels;
  const bpp = channels;
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const line = new Uint8Array(1 + stride);

  const cs = new CompressionStream("deflate");
  const compressed = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();
  let batch = new Uint8Array(Math.max(BATCH, 1 + stride));
  let used = 0;

  for (let y = 0; y < height; y++) {
    // Gather the row in the output layout.
    let s = y * width * 4;
    if (channels === 4) cur.set(data.subarray(s, s + stride));
    else
      for (let x = 0, o = 0; x < width; x++, s += 4, o += 3) {
        cur[o] = data[s];
        cur[o + 1] = data[s + 1];
        cur[o + 2] = data[s + 2];
      }
    // Pick the filter with the smallest sum of |signed residual|.
    let best = 0;
    let bestCost = Infinity;
    for (let f = 0; f < 5; f++) {
      let cost = 0;
      for (let i = 0; i < stride && cost < bestCost; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const pred =
          f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (cur[i] - pred) & 255;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
      }
    }
    line[0] = best;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const pred =
        best === 0
          ? 0
          : best === 1
            ? a
            : best === 2
              ? b
              : best === 3
                ? (a + b) >> 1
                : paeth(a, b, c);
      line[1 + i] = (cur[i] - pred) & 255;
    }
    if (used + line.length > batch.length) {
      await writer.write(batch.subarray(0, used));
      batch = new Uint8Array(batch.length);
      used = 0;
    }
    batch.set(line, used);
    used += line.length;
    const t = prev;
    prev = cur;
    cur = t;
  }
  if (used) await writer.write(batch.subarray(0, used));
  await writer.close();
  const z = new Uint8Array(await compressed);

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const parts: Uint8Array[] = [SIGNATURE, chunk("IHDR", ihdr)];
  for (let i = 0; i < z.length; i += IDAT_MAX)
    parts.push(chunk("IDAT", z.subarray(i, i + IDAT_MAX)));
  parts.push(chunk("IEND", new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

/** Top-level chunk types of a PNG, in order (for output verification). */
export function pngChunkTypes(bytes: Uint8Array): string[] | null {
  if (!readPngHeader(bytes)) return null;
  const types: string[] = [];
  let i = 8;
  for (; i + 12 <= bytes.length;) {
    const len = be32(bytes, i);
    types.push(ascii(bytes, i + 4));
    i += 12 + len;
  }
  return i === bytes.length ? types : null;
}
