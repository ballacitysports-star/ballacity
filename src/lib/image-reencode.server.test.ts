/* eslint-disable @typescript-eslint/no-explicit-any -- the sharp factory is wrapped structurally to record its inputs */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { stripImageMetadata } from "./image-metadata";
import { ImageReencodeError, REENCODE_MESSAGES, reencodeImage } from "./image-reencode.server";

/**
 * SEC-6 / M2: every published picture is decoded and re-encoded. These tests pin that the output is a fresh file of the same
 * type with the picture upright, transparent where the upload was, and carrying nothing else: no metadata and none of the
 * bytes an uploader can hide in data the byte stripper keeps (ICC profile, the tail before a JPEG EOI, duplicate PNG/WEBP
 * chunks, extra IDAT, a whole second image).
 */

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
const contains = (hay: Uint8Array, needle: Uint8Array) =>
  Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).indexOf(Buffer.from(needle)) >= 0;
const be32 = (n: number) => Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
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
const pchunk = (type: string, data: Uint8Array, badCrc = false) => {
  const body = cat(enc.encode(type), data);
  return cat(be32(data.length), body, be32(badCrc ? crc(body) ^ 1 : crc(body)));
};
const wchunk = (type: string, data: Uint8Array) =>
  cat(
    enc.encode(type),
    le32(data.length),
    data,
    data.length & 1 ? new Uint8Array(1) : new Uint8Array(0),
  );
const riff = (body: Uint8Array) =>
  cat(enc.encode("RIFF"), le32(4 + body.length), enc.encode("WEBP"), body);

/** Top-level structure of a file, to prove what the encoder wrote. */
function structure(b: Uint8Array): string[] {
  const out: string[] = [];
  if (b[0] === 0x89) {
    for (let i = 8; i + 8 <= b.length;) {
      const n = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      out.push(String.fromCharCode(...b.subarray(i + 4, i + 8)));
      i += 12 + n;
    }
  } else if (b[0] === 0xff) {
    for (let i = 2; i + 4 <= b.length;) {
      const m = b[i + 1];
      out.push(m.toString(16));
      if (m === 0xda) break;
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  } else {
    for (let i = 12; i + 8 <= b.length;) {
      const n = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      out.push(String.fromCharCode(...b.subarray(i, i + 4)));
      i += 8 + n + (n & 1);
    }
  }
  return out;
}

async function expectNoMetadata(bytes: Uint8Array) {
  const m = await sharp(bytes).metadata();
  expect(m.exif).toBeUndefined();
  expect(m.icc).toBeUndefined();
  expect(m.xmp).toBeUndefined();
  expect(m.iptc).toBeUndefined();
  expect(m.orientation).toBeUndefined();
  const s = structure(bytes);
  if (m.format === "jpeg") {
    // only tables, frame and scan: no APPn (EXIF e1, ICC e2, IPTC ed, ...) and no COM (fe)
    for (const marker of s) expect(["db", "c0", "c4", "dd", "da"]).toContain(marker);
  } else if (m.format === "png") {
    for (const chunk of s)
      expect(["IHDR", "pHYs", "PLTE", "tRNS", "IDAT", "IEND"]).toContain(chunk);
  } else {
    for (const chunk of s) expect(["VP8X", "ALPH", "VP8 ", "VP8L"]).toContain(chunk);
  }
}

async function meanAbsDiff(a: Uint8Array, b: Uint8Array) {
  const ra = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rb = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([ra.info.width, ra.info.height]).toEqual([rb.info.width, rb.info.height]);
  let d = 0;
  for (let i = 0; i < ra.data.length; i++) d += Math.abs(ra.data[i] - rb.data[i]);
  return d / ra.data.length;
}

const solid = (w: number, h: number, colour: string) =>
  sharp({ create: { width: w, height: h, channels: 3, background: colour } });
const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

async function alphaPng() {
  // a gradient with real transparency: alpha runs 0..255 across, colour varies down
  const w = 96;
  const h = 80;
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

const PAYLOAD = enc.encode("HIDDEN-PAYLOAD::second-image::0123456789abcdef");

describe("reencodeImage: real pictures", () => {
  const upright = u8(readFileSync("e2e/fixtures/exif/upright-reference.png"));

  it.each(["o1", "o3", "o6", "o8"])(
    "phone JPEG %s: re-encoded upright (orientation applied to the pixels), same picture, no metadata",
    async (name) => {
      const input = u8(readFileSync(`e2e/fixtures/exif/${name}.jpg`));
      expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture carries EXIF
      const out = await reencodeImage(input);
      expect(out.mime).toBe("image/jpeg");
      expect([out.width, out.height]).toEqual([200, 100]);
      const m = await sharp(out.bytes).metadata();
      expect([m.format, m.width, m.height]).toEqual(["jpeg", 200, 100]);
      await expectNoMetadata(out.bytes);
      // the pixels are what an EXIF-aware viewer shows (JPEG q85 of a flat test card: small error only)
      const viewed = u8(await sharp(input).autoOrient().png().toBuffer());
      expect(await meanAbsDiff(out.bytes, viewed)).toBeLessThan(6);
      // o1/o3 also match the upright reference. o6/o8 do not, for ANY spec-following decoder: the fixture generator stores them
      // rotated the wrong way (scripts/generate-exif-fixtures.py, STORED_ROTATION 6 and 8 swapped), so a viewer shows them 180
      // degrees off the reference. Reported as an open item; the generated orientation tests below cover 2-8 independently.
      if (name === "o1" || name === "o3")
        expect(await meanAbsDiff(out.bytes, upright)).toBeLessThan(6);
      else expect(await meanAbsDiff(out.bytes, upright)).toBeGreaterThan(100);
    },
  );

  const assets = readdirSync("src/assets").filter((f) => f.endsWith(".jpg"));
  it.each(assets)("repo JPEG %s keeps its dimensions and loses its metadata", async (f) => {
    const input = u8(readFileSync(`src/assets/${f}`));
    const before = await sharp(input).metadata();
    const out = await reencodeImage(input);
    expect([out.width, out.height]).toEqual([before.width, before.height]);
    await expectNoMetadata(out.bytes);
    expect(await meanAbsDiff(out.bytes, input)).toBeLessThan(4);
  });

  it.each(["icon-192.png", "icon-512.png", "apple-touch-icon.png", "icon-maskable-512.png"])(
    "repo PNG %s is re-encoded losslessly",
    async (f) => {
      const input = u8(readFileSync(`public/icons/${f}`));
      const out = await reencodeImage(input);
      expect(out.mime).toBe("image/png");
      expect(out.lossless).toBe(true);
      await expectNoMetadata(out.bytes);
      expect(await meanAbsDiff(out.bytes, input)).toBe(0);
    },
  );

  it("a PNG with transparency keeps its alpha channel exactly", async () => {
    const input = await alphaPng();
    const out = await reencodeImage(input);
    expect(out.hasAlpha).toBe(true);
    await expectNoMetadata(out.bytes);
    const a = await sharp(input).raw().toBuffer();
    const b = await sharp(out.bytes).raw().toBuffer();
    expect(Buffer.compare(a, b)).toBe(0); // lossless, RGBA identical
  });

  it("a lossy WEBP with transparency stays WEBP, keeps alpha, keeps its size", async () => {
    const input = u8(
      await sharp(await alphaPng())
        .webp({ quality: 90 })
        .toBuffer(),
    );
    const out = await reencodeImage(input);
    expect(out.mime).toBe("image/webp");
    expect(out.lossless).toBe(false);
    expect(out.hasAlpha).toBe(true);
    expect([out.width, out.height]).toEqual([96, 80]);
    await expectNoMetadata(out.bytes);
    expect(structure(out.bytes)).toContain("ALPH");
  });

  it("a lossless WEBP stays lossless (pixel-identical)", async () => {
    const input = u8(
      await sharp(await alphaPng())
        .webp({ lossless: true })
        .toBuffer(),
    );
    const out = await reencodeImage(input);
    expect(out.lossless).toBe(true);
    expect(structure(out.bytes)).toEqual(["VP8L"]);
    const a = await sharp(input).raw().toBuffer();
    const b = await sharp(out.bytes).raw().toBuffer();
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it.each([
    [2, "jpeg"],
    [4, "png"],
    [5, "webp"],
    [7, "jpeg"],
    [6, "png"],
    [8, "webp"],
  ] as const)(
    "orientation %i in a %s is applied to the pixels exactly as a viewer would, then dropped",
    async (orientation, fmt) => {
      const raw = Buffer.alloc(120 * 80 * 3);
      for (let i = 0; i < raw.length; i += 3) raw[i] = (i / 3) % 120 < 30 ? 255 : 0; // a left stripe
      const base = sharp(raw, { raw: { width: 120, height: 80, channels: 3 } });
      const input = u8(
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
      const out = await reencodeImage(input);
      expect(out.orientation).toBe(orientation);
      const want = u8(await sharp(input).autoOrient().png().toBuffer());
      expect([out.width, out.height]).toEqual(orientation >= 5 ? [80, 120] : [120, 80]);
      expect(await meanAbsDiff(out.bytes, want)).toBeLessThan(fmt === "jpeg" ? 6 : 0.001);
      await expectNoMetadata(out.bytes);
    },
  );

  it("a wide-gamut (Display P3) photo is converted to sRGB and the profile is not embedded", async () => {
    const input = u8(
      await solid(96, 64, "#c03020").withIccProfile("p3").jpeg({ quality: 95 }).toBuffer(),
    );
    expect((await sharp(input).metadata()).icc).toBeDefined();
    const out = await reencodeImage(input);
    expect(out.convertedFromIcc).toBe(true);
    await expectNoMetadata(out.bytes);
    // the colours went through the profile: they match sharp's own P3 -> sRGB conversion, not the raw P3 numbers
    const converted = u8(await sharp(input).toColourspace("srgb").png().toBuffer());
    expect(await meanAbsDiff(out.bytes, converted)).toBeLessThan(3);
  });
});

describe("reencodeImage: payloads hidden in data the byte stripper keeps never survive", () => {
  async function expectClean(input: Uint8Array, needles: Uint8Array[]) {
    // precondition: the byte stripper alone would have published the payload
    const stripped = stripImageMetadata(input).bytes;
    expect(needles.some((n) => contains(stripped, n))).toBe(true);
    const out = await reencodeImage(input);
    for (const n of needles) expect(contains(out.bytes, n)).toBe(false);
    await expectNoMetadata(out.bytes);
    return out;
  }

  it("inside the ICC profile (JPEG APP2)", async () => {
    const p3 = u8(await solid(96, 64, "#c03020").withIccProfile("p3").jpeg().toBuffer());
    let crafted: Uint8Array | null = null;
    for (let i = 2; i < p3.length;) {
      const len = (p3[i + 2] << 8) | p3[i + 3];
      if (p3[i + 1] === 0xe2) {
        const n = len + PAYLOAD.length;
        crafted = cat(
          p3.subarray(0, i),
          Uint8Array.from([0xff, 0xe2, n >> 8, n & 255]),
          p3.subarray(i + 4, i + 2 + len),
          PAYLOAD,
          p3.subarray(i + 2 + len),
        );
        break;
      }
      i += 2 + len;
    }
    const out = await expectClean(crafted!, [PAYLOAD]);
    expect(out.convertedFromIcc).toBe(true);
  });

  it("in the JPEG tail before EOI (a second image smuggled after the scan)", async () => {
    const j = u8(await solid(96, 64, "#2080c0").jpeg().toBuffer());
    const hidden = enc.encode(
      Buffer.from(await solid(64, 64, "#ff00ff").png().toBuffer()).toString("base64"),
    );
    const crafted = cat(
      j.subarray(0, j.length - 2),
      PAYLOAD,
      hidden,
      Uint8Array.from([0xff, 0xd9]),
    );
    await expectClean(crafted, [PAYLOAD, hidden.subarray(0, 48)]);
  });

  it("a whole second WEBP image in a duplicate VP8 chunk", async () => {
    const shown = u8(await solid(96, 64, "#ff0000").webp({ quality: 80 }).toBuffer());
    const hidden = u8(await solid(96, 64, "#0000ff").webp({ quality: 80 }).toBuffer());
    const crafted = riff(cat(shown.subarray(12), hidden.subarray(12)));
    const out = await expectClean(crafted, [hidden.subarray(20, 60)]);
    const px = await sharp(out.bytes).raw().toBuffer();
    expect(px[0]).toBeGreaterThan(200); // what was shown (red) is what is published
    expect(px[2]).toBeLessThan(40);
  });

  it("in duplicate WEBP ICCP chunks", async () => {
    const shown = u8(await solid(96, 64, "#00ff00").webp({ quality: 80 }).toBuffer());
    const icc = (
      await sharp(u8(await solid(8, 8, "#000").withIccProfile("srgb").jpeg().toBuffer())).metadata()
    ).icc!;
    const vp8x = Uint8Array.from([0x20, 0, 0, 0, 95, 0, 0, 63, 0, 0]); // ICC flag, 96x64
    const crafted = riff(
      cat(
        wchunk("VP8X", vp8x),
        wchunk("ICCP", u8(icc)),
        wchunk("ICCP", PAYLOAD),
        shown.subarray(12),
      ),
    );
    await expectClean(crafted, [PAYLOAD]);
  });

  it("in duplicate PNG chunks, an extra IDAT after the image data, and a chunk whose CRC is wrong", async () => {
    const png = u8(await solid(80, 64, "#336699").png().toBuffer());
    const ihdrEnd = 8 + 25;
    const iend = png.length - 12;
    const crafted = cat(
      png.subarray(0, ihdrEnd),
      pchunk("pHYs", cat(PAYLOAD.subarray(0, 8), Uint8Array.from([1]))),
      pchunk("pHYs", cat(PAYLOAD.subarray(8, 16), Uint8Array.from([1]))),
      png.subarray(ihdrEnd, iend),
      pchunk("IDAT", PAYLOAD), // extra compressed data after the zlib stream ended
      pchunk("bKGD", PAYLOAD.subarray(0, 6), true),
      png.subarray(iend),
    );
    await expectClean(crafted, [PAYLOAD.subarray(0, 8), PAYLOAD.subarray(8, 16), PAYLOAD]);
  });

  it("appended after the end of the file", async () => {
    const j = u8(await solid(96, 64, "#808080").jpeg().toBuffer());
    const out = await reencodeImage(cat(j, PAYLOAD));
    expect(contains(out.bytes, PAYLOAD)).toBe(false);
  });
});

describe("reencodeImage: refusals", () => {
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ImageReencodeError);
      expect((e as ImageReencodeError).message).toBe(
        REENCODE_MESSAGES[(e as ImageReencodeError).code],
      );
      return (e as ImageReencodeError).code;
    }
    return "accepted";
  };

  it("refuses a decompression bomb by pixel count before decoding (limitInputPixels)", async () => {
    // 7000 x 7000 = 49 MP of one colour: a few KB on disk
    const bomb = u8(await solid(7000, 7000, "#000").png({ compressionLevel: 9 }).toBuffer());
    expect(bomb.byteLength).toBeLessThan(200_000);
    expect(await code(reencodeImage(bomb))).toBe("too_large");
    // the cap is sharp's own limit, not only our header check
    const small = u8(await solid(300, 300, "#000").jpeg().toBuffer());
    expect(await code(reencodeImage(small, { maxPixels: 300 * 300 - 1 }))).toBe("too_large");
    expect(await code(reencodeImage(small, { maxPixels: 300 * 300 }))).toBe("accepted");
  });

  it("refuses a JPEG whose header claims a huge frame", async () => {
    const j = u8(await solid(64, 64, "#000").jpeg().toBuffer());
    // patch the SOF0 dimensions to 60000 x 60000
    const k = Buffer.from(j).indexOf(Buffer.from([0xff, 0xc0]));
    const patched = j.slice();
    patched.set([0xea, 0x60, 0xea, 0x60], k + 5);
    expect(["too_large", "unreadable"]).toContain(await code(reencodeImage(patched)));
  });

  it.each([
    ["GIF", async () => u8(await solid(64, 64, "#f00").gif().toBuffer())],
    ["TIFF", async () => u8(await solid(64, 64, "#f00").tiff().toBuffer())],
    ["AVIF", async () => u8(await solid(64, 64, "#f00").avif().toBuffer())],
    [
      "SVG",
      async () => enc.encode('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>'),
    ],
    ["BMP", async () => cat(enc.encode("BM"), new Uint8Array(62))],
    ["random bytes", async () => Uint8Array.from({ length: 512 }, (_, i) => (i * 37) & 255)],
    ["an empty file", async () => new Uint8Array(0)],
  ])("refuses %s as unsupported", async (_n, make) => {
    expect(await code(reencodeImage(await make()))).toBe("unsupported");
  });

  it("refuses a truncated JPEG and a PNG with a corrupt image stream", async () => {
    const j = u8(await solid(96, 64, "#123").jpeg().toBuffer());
    expect(await code(reencodeImage(j.subarray(0, j.length - 40)))).toBe("unreadable");
    const p = u8(await solid(96, 64, "#123").png().toBuffer());
    const corrupt = p.slice();
    const idat = Buffer.from(p).indexOf(Buffer.from("IDAT"));
    for (let i = idat + 6; i < idat + 20; i++) corrupt[i] ^= 0x5a;
    // fix the CRC so only the image stream is wrong
    const len = (p[idat - 4] << 24) | (p[idat - 3] << 16) | (p[idat - 2] << 8) | p[idat - 1];
    corrupt.set(be32(crc(corrupt.subarray(idat, idat + 4 + len))), idat + 4 + len);
    expect(await code(reencodeImage(corrupt))).toBe("unreadable");
  });

  it("refuses an animated WEBP and an animated PNG (APNG)", async () => {
    const f = (c: string) => solid(64, 64, c).png().toBuffer();
    const anim = u8(
      await sharp([await f("#f00"), await f("#00f")], { join: { animated: true } })
        .webp()
        .toBuffer(),
    );
    expect(await code(reencodeImage(anim))).toBe("animated");
    const still = u8(await solid(64, 64, "#0f0").png().toBuffer());
    const ihdrEnd = 8 + 25;
    const apng = cat(
      still.subarray(0, ihdrEnd),
      pchunk("acTL", Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0])),
      pchunk("fcTL", cat(be32(0), be32(64), be32(64), new Uint8Array(14))),
      still.subarray(ihdrEnd),
    );
    expect(await code(reencodeImage(apng))).toBe("animated");
  });

  it("fails closed with 'unavailable' when the image library cannot load", async () => {
    const j = u8(await solid(64, 64, "#000").jpeg().toBuffer());
    expect(
      await code(
        reencodeImage(j, { loadSharp: () => Promise.reject(new Error("no native modules")) }),
      ),
    ).toBe("unavailable");
  });
});

describe("reencodeImage: what the native decoder is given", () => {
  const spy = () => {
    const calls: { input: Uint8Array; opts: any }[] = [];
    const factory = Object.assign((input: any, opts?: any) => {
      calls.push({ input, opts });
      return sharp(input, opts);
    }, sharp) as unknown as typeof sharp;
    return { calls, loadSharp: async () => factory };
  };

  it("every decode is capped by limitInputPixels (decompression bombs)", async () => {
    const { calls, loadSharp } = spy();
    await reencodeImage(u8(readFileSync("e2e/fixtures/exif/o6.jpg")), { loadSharp });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c.opts.limitInputPixels).toBe(30_000_000);
  });

  it("the decoder reads the stripper's output: the upload's EXIF and XMP never reach libvips", async () => {
    const xmp = enc.encode('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta GPSLatitude="33.7488"/>');
    const base = u8(
      await solid(96, 64, "#406080").withMetadata({ orientation: 6 }).jpeg().toBuffer(),
    );
    const n = xmp.length + 2;
    const input = cat(
      base.subarray(0, 2),
      Uint8Array.from([0xff, 0xe1, n >> 8, n & 255]),
      xmp,
      base.subarray(2),
    );
    const { calls, loadSharp } = spy();
    const out = await reencodeImage(input, { loadSharp });
    expect(out.orientation).toBe(6); // the orientation still arrives (in the stripper's own EXIF block)
    const firstDecode = calls[0].input;
    expect(contains(firstDecode, enc.encode("GPSLatitude"))).toBe(false);
    expect(contains(input, enc.encode("GPSLatitude"))).toBe(true);
  });
});

describe("reencodeImage: idempotence", () => {
  it("the same upload always gives the same bytes (a retry publishes identical bytes)", async () => {
    for (const input of [
      u8(readFileSync("e2e/fixtures/exif/o6.jpg")),
      await alphaPng(),
      u8(
        await sharp(await alphaPng())
          .webp({ quality: 80 })
          .toBuffer(),
      ),
    ]) {
      const a = await reencodeImage(input);
      const b = await reencodeImage(input);
      expect(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes))).toBe(0);
    }
  });

  it("re-encoding an already re-encoded file is stable: same type and size, PNG byte-identical, JPEG/WEBP visually identical", async () => {
    const png = await reencodeImage(await alphaPng());
    const png2 = await reencodeImage(png.bytes);
    expect(Buffer.compare(Buffer.from(png.bytes), Buffer.from(png2.bytes))).toBe(0);
    for (const input of [
      u8(readFileSync("e2e/fixtures/exif/o8.jpg")),
      u8(
        await sharp(await alphaPng())
          .webp({ quality: 80 })
          .toBuffer(),
      ),
    ]) {
      const once = await reencodeImage(input);
      const twice = await reencodeImage(once.bytes);
      expect([twice.mime, twice.width, twice.height, twice.orientation]).toEqual([
        once.mime,
        once.width,
        once.height,
        null,
      ]);
      await expectNoMetadata(twice.bytes);
      expect(await meanAbsDiff(once.bytes, twice.bytes)).toBeLessThan(2.5);
    }
  });
});
