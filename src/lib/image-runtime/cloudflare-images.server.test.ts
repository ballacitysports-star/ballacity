/* eslint-disable @typescript-eslint/no-explicit-any -- fake bindings are built structurally */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { inspectImageMetadata, stripImageMetadata } from "@/lib/image-metadata";
import {
  ImageReencodeError,
  REENCODE_MESSAGES,
  quantiseHiddenColour,
  type ReencodeErrorCode,
} from "@/lib/image-reencode.server";
import {
  ORIENTATION_TRANSFORMS,
  outputContainerProblem,
  reencodeImageWithCloudflareImages,
  type CloudflareReencodeOptions,
} from "./cloudflare-images.server";
import { pngChunkTypes } from "./png-codec";
import { reencodeResultProblem } from "./reencode-contract";
import {
  FakeImagesError,
  createDocumentedImagesFake,
  createLocalModeImagesFake,
  type FakeBinding,
  type FakeHooks,
} from "./test-support/fake-images-binding";
import {
  HIDDEN_W,
  PAYLOAD,
  alphaPng,
  be32,
  cat,
  contains,
  crc,
  enc,
  hiddenAlphaImage,
  hiddenAlphaPixels,
  jpegWithSegment,
  meanAbsDiff,
  orientedCard,
  pchunk,
  pngWithChunk,
  riff,
  solid,
  u8,
  wchunk,
} from "./test-support/fixtures";

/**
 * EVIDENCE LEVEL. Every result in this file comes from a FAKE binding built on sharp, never from Cloudflare (no account exists):
 * "doc" = createDocumentedImagesFake (production behaviour as documented, worst case where the docs are silent), "local" =
 * createLocalModeImagesFake (a port of Wrangler's offline mode). These tests prove the PoC's own logic: what it sends, what it
 * checks, and that it fails closed. They do not prove what the real platform returns; see docs/privacy/image-runtime-evaluation.md,
 * "Must be validated on a real account".
 */

type Make = (hooks?: FakeHooks) => FakeBinding;
const BINDINGS: [string, Make][] = [
  ["doc", createDocumentedImagesFake],
  ["local", createLocalModeImagesFake],
];

const re = (input: Uint8Array, images: any, opts: Partial<CloudflareReencodeOptions> = {}) =>
  reencodeImageWithCloudflareImages(input, { images, ...opts });

const code = async (p: Promise<unknown>): Promise<ReencodeErrorCode | "accepted"> => {
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

/** No metadata by sharp's reading, by the byte inspector, and by the PoC's own container allow-list. */
async function expectClean(bytes: Uint8Array) {
  const m = await sharp(bytes).metadata();
  expect([m.exif, m.icc, m.xmp, m.iptc, m.orientation]).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  const r = inspectImageMetadata(bytes);
  expect([r.hasExif, r.hasGps, r.hasXmp, r.hasOther, r.orientation, r.animated]).toEqual([
    false,
    false,
    false,
    false,
    null,
    false,
  ]);
  const mime = `image/${m.format}` as "image/jpeg" | "image/png" | "image/webp";
  expect(outputContainerProblem(bytes, mime)).toBeNull();
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe("cloudflare-images PoC: real pictures (doc fake)", () => {
  it.each(["o1", "o3", "o6", "o8"])(
    "phone JPEG %s: upright, same picture, no metadata, never the input bytes",
    async (name) => {
      const input = u8(readFileSync(`e2e/fixtures/exif/${name}.jpg`));
      const images = createDocumentedImagesFake();
      const out = await re(input, images);
      expect([out.mime, out.width, out.height]).toEqual(["image/jpeg", 200, 100]);
      await expectClean(out.bytes);
      expect(sameBytes(out.bytes, input)).toBe(false);
      const viewed = u8(await sharp(input).autoOrient().png().toBuffer());
      expect(await meanAbsDiff(out.bytes, viewed)).toBeLessThan(6);
    },
  );

  it("repo PNG icons are re-encoded losslessly into a container the Worker wrote itself", async () => {
    for (const f of ["icon-192.png", "apple-touch-icon.png"]) {
      const input = u8(readFileSync(`public/icons/${f}`));
      const out = await re(input, createDocumentedImagesFake());
      expect(out.lossless).toBe(true);
      expect(pngChunkTypes(out.bytes)).toEqual(["IHDR", "IDAT", "IEND"]);
      await expectClean(out.bytes);
      const a = await sharp(input).ensureAlpha().raw().toBuffer();
      quantiseHiddenColour(a, 4);
      const b = await sharp(out.bytes).ensureAlpha().raw().toBuffer();
      expect(sameBytes(a, b)).toBe(true);
    }
  });

  it("a Display P3 photo is converted to sRGB and no profile is embedded", async () => {
    const input = u8(
      await solid(96, 64, "#c03020").withIccProfile("p3").jpeg({ quality: 95 }).toBuffer(),
    );
    const out = await re(input, createDocumentedImagesFake());
    expect(out.convertedFromIcc).toBe(true);
    await expectClean(out.bytes);
    const converted = u8(await sharp(input).toColourspace("srgb").png().toBuffer());
    expect(await meanAbsDiff(out.bytes, converted)).toBeLessThan(3);
  });
});

describe("cloudflare-images PoC: personal metadata never reaches Cloudflare or the output", () => {
  const GPS = enc.encode("GPSLatitude=33.7488");
  const XMP = enc.encode('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta GPSLatitude="33.7488"/>');

  it.each(BINDINGS)("JPEG with EXIF GPS, XMP and a comment (%s)", async (_n, make) => {
    const exif = u8(
      await solid(96, 64, "#406080")
        .withExif({
          IFD0: { Copyright: "uploader-copyright", Artist: "kid name" },
          IFD3: { GPSLatitudeRef: "N" },
        } as any)
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );
    const input = jpegWithSegment(jpegWithSegment(exif, 0xe1, XMP), 0xfe, GPS);
    expect(inspectImageMetadata(input).hasExif).toBe(true);
    const images = make();
    const out = await re(input, images);
    expect(out.orientation).toBe(6);
    expect(out.inputReport.hasXmp).toBe(true);
    // Nothing the binding received carries EXIF (so Cloudflare's default metadata=copyright has no copyright tag to keep).
    for (const call of images.calls) {
      const r = inspectImageMetadata(call.input);
      expect([r.hasExif, r.hasGps, r.hasXmp, r.orientation]).toEqual([false, false, false, null]);
      for (const needle of [GPS, XMP, enc.encode("uploader-copyright"), enc.encode("kid name")])
        expect(contains(call.input, needle)).toBe(false);
    }
    await expectClean(out.bytes);
  });

  it.each(BINDINGS)("PNG text chunks and WEBP EXIF/XMP chunks (%s)", async (_n, make) => {
    const png = pngWithChunk(
      u8(await solid(80, 64, "#336699").png().toBuffer()),
      pchunk("tEXt", cat(enc.encode("Comment\0"), PAYLOAD)),
    );
    const vp8 = u8(await solid(96, 64, "#00ff00").webp({ quality: 80 }).toBuffer());
    const webp = riff(
      cat(
        wchunk("VP8X", Uint8Array.from([0x0c, 0, 0, 0, 95, 0, 0, 63, 0, 0])),
        vp8.subarray(12),
        wchunk("EXIF", PAYLOAD),
        wchunk("XMP ", XMP),
      ),
    );
    for (const input of [png, webp]) {
      const images = make();
      const out = await re(input, images);
      for (const call of images.calls) expect(contains(call.input, PAYLOAD)).toBe(false);
      expect(contains(out.bytes, PAYLOAD)).toBe(false);
      await expectClean(out.bytes);
    }
  });
});

describe("cloudflare-images PoC: payloads in data the byte stripper keeps do not survive", () => {
  it.each(BINDINGS)(
    "ICC payload, JPEG tail before EOI, data after EOI/IEND/RIFF (%s)",
    async (_n, make) => {
      const p3 = u8(await solid(96, 64, "#c03020").withIccProfile("p3").jpeg().toBuffer());
      let icc: Uint8Array | null = null;
      for (let i = 2; i < p3.length;) {
        const len = (p3[i + 2] << 8) | p3[i + 3];
        if (p3[i + 1] === 0xe2) {
          const n = len + PAYLOAD.length;
          icc = cat(
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
      // quality 90: an input made with the local mode's own encoder defaults (sharp q80) would come back byte-identical, which
      // the PoC refuses as a pass-through (see "a pass-through binding" below)
      const j = u8(await solid(96, 64, "#2080c0").jpeg({ quality: 90 }).toBuffer());
      const tail = cat(j.subarray(0, j.length - 2), PAYLOAD, Uint8Array.from([0xff, 0xd9]));
      const appended = [
        cat(j, PAYLOAD),
        cat(u8(await solid(80, 64, "#123456").png().toBuffer()), PAYLOAD),
        cat(u8(await solid(80, 64, "#654321").webp({ quality: 70 }).toBuffer()), PAYLOAD),
      ];
      for (const input of [icc!, tail, ...appended]) {
        const out = await re(input, make());
        expect(contains(out.bytes, PAYLOAD)).toBe(false);
        await expectClean(out.bytes);
      }
    },
  );

  it.each(BINDINGS)(
    "duplicate PNG chunks, extra IDAT, bad CRC; a second WEBP image in a duplicate VP8 (%s)",
    async (_n, make) => {
      const png = u8(await solid(80, 64, "#336699").png().toBuffer());
      const iend = png.length - 12;
      const crafted = cat(
        png.subarray(0, 33),
        pchunk("pHYs", cat(PAYLOAD.subarray(0, 8), Uint8Array.from([1]))),
        pchunk("pHYs", cat(PAYLOAD.subarray(8, 16), Uint8Array.from([1]))),
        png.subarray(33, iend),
        pchunk("IDAT", PAYLOAD),
        pchunk("bKGD", PAYLOAD.subarray(0, 6), true),
        png.subarray(iend),
      );
      const out = await re(crafted, make());
      for (const n of [PAYLOAD.subarray(0, 8), PAYLOAD.subarray(8, 16), PAYLOAD])
        expect(contains(out.bytes, n)).toBe(false);
      expect(pngChunkTypes(out.bytes)).toEqual(["IHDR", "IDAT", "IEND"]); // not even the encoder's pHYs: the Worker wrote it

      const shown = u8(await solid(96, 64, "#ff0000").webp({ quality: 80 }).toBuffer());
      const hidden = u8(await solid(96, 64, "#0000ff").webp({ quality: 80 }).toBuffer());
      const w = await re(riff(cat(shown.subarray(12), hidden.subarray(12))), make());
      expect(contains(w.bytes, hidden.subarray(20, 60))).toBe(false);
      const px = await sharp(w.bytes).raw().toBuffer();
      expect(px[0]).toBeGreaterThan(200);
      expect(px[2]).toBeLessThan(40);
    },
  );
});

describe("cloudflare-images PoC: animation", () => {
  const frames = async () => {
    const f = (c: string) => solid(64, 64, c).png().toBuffer();
    return [await f("#f00"), await f("#00f")];
  };

  it.each(BINDINGS)(
    "animated WEBP and APNG are refused before the binding is called (%s)",
    async (_n, make) => {
      const anim = u8(
        await sharp(await frames(), { join: { animated: true } })
          .webp()
          .toBuffer(),
      );
      const still = u8(await solid(64, 64, "#0f0").png().toBuffer());
      const apng = cat(
        still.subarray(0, 33),
        pchunk("acTL", Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0])),
        pchunk("fcTL", cat(be32(0), be32(64), be32(64), new Uint8Array(14))),
        still.subarray(33),
      );
      for (const input of [anim, apng]) {
        const images = make();
        expect(await code(re(input, images))).toBe("animated");
        expect(images.calls).toHaveLength(0);
      }
    },
  );

  it("the binding's .info() does not report frames, so it cannot be the animation detector (doc and local)", async () => {
    const anim = u8(
      await sharp(await frames(), { join: { animated: true } })
        .webp()
        .toBuffer(),
    );
    for (const [, make] of BINDINGS) {
      const info: any = await make().info(new Blob([anim as BlobPart]).stream() as any);
      expect(Object.keys(info).sort()).toEqual(["fileSize", "format", "height", "width"]);
    }
  });

  it("an animated GIF is refused as unsupported (never sent)", async () => {
    const gif = u8(
      await sharp(await frames(), { join: { animated: true } })
        .gif()
        .toBuffer(),
    );
    const images = createDocumentedImagesFake();
    expect(await code(re(gif, images))).toBe("unsupported");
    expect(images.calls).toHaveLength(0);
  });
});

describe("cloudflare-images PoC: colour hidden under transparency (finding 1)", () => {
  it("precondition: the modelled platform AND Wrangler's local mode both keep the hidden RGB in a plain PNG output", async () => {
    for (const [, make] of BINDINGS) {
      const input = await hiddenAlphaImage(0, "png");
      const r = await make()
        .input(new Blob([input as BlobPart]).stream() as any)
        .output({ format: "image/png" });
      const px = await sharp(u8(Buffer.from(await new Response(r.image()).arrayBuffer())))
        .raw()
        .toBuffer();
      expect(px[(5 * HIDDEN_W + 40) * 4]).toBe(160); // the hidden gradient is still there
    }
  });

  it.each([
    [0, "png", "doc"],
    [1, "png", "doc"],
    [0, "webp", "doc"],
    [1, "webp", "doc"],
    [0, "png", "local"],
    [1, "png", "local"],
  ] as const)(
    "alpha %i in a lossless %s (%s): colour quantised, alpha kept exactly",
    async (alpha, format, which) => {
      const input = await hiddenAlphaImage(alpha, format);
      const out = await re(
        input,
        which === "doc" ? createDocumentedImagesFake() : createLocalModeImagesFake(),
      );
      expect(out.lossless).toBe(true);
      expect(out.hasAlpha).toBe(true);
      const px = await sharp(out.bytes).ensureAlpha().raw().toBuffer();
      const original = hiddenAlphaPixels(alpha);
      for (let i = 0; i < px.length; i += 4) {
        expect(px[i + 3]).toBe(original[i + 3]);
        if (px[i + 3] === 255)
          expect([px[i], px[i + 1], px[i + 2]]).toEqual([
            original[i],
            original[i + 1],
            original[i + 2],
          ]);
        else if (px[i + 3] === 0) expect([px[i], px[i + 1], px[i + 2]]).toEqual([0, 0, 0]);
        else for (let c = 0; c < 3; c++) expect([0, 255]).toContain(px[i + c]);
      }
    },
  );

  const renditionBytes = (r: string) => u8(Buffer.from(r.split(",")[1], "base64"));

  it("partial transparency: published colour is premultiplied and quantised, and all three scan renditions exist (contract v2)", async () => {
    const input = await alphaPng();
    const out = await re(input, createDocumentedImagesFake());
    const a = await sharp(input).raw().toBuffer();
    quantiseHiddenColour(a, 4);
    expect(sameBytes(a, await sharp(out.bytes).raw().toBuffer())).toBe(true);
    expect(out.transparency).toBe("partial");
    expect(out.scanRenditions).toHaveLength(3);
    for (const r of out.scanRenditions) {
      const m = await sharp(renditionBytes(r)).metadata();
      expect([m.format, m.width, m.height, m.hasAlpha]).toEqual(["jpeg", 96, 80, false]);
    }
    expect(reencodeResultProblem(out)).toBeNull();
  });

  it("binary alpha: flattened on white and on black (2 renditions); fully opaque: none", async () => {
    const binary = await re(await hiddenAlphaImage(0, "png"), createDocumentedImagesFake());
    expect([binary.transparency, binary.scanRenditions.length]).toEqual(["binary", 2]);
    expect(reencodeResultProblem(binary)).toBeNull();
    const opaque = await re(
      u8(await solid(80, 64, "#abcdef").png().toBuffer()),
      createDocumentedImagesFake(),
    );
    expect([opaque.transparency, opaque.scanRenditions]).toEqual(["none", []]);
    expect(reencodeResultProblem(opaque)).toBeNull();
  });

  it("F09: a picture drawn in the alpha channel alone is plain to see in one of the flattened renditions", async () => {
    // RGB all 0; a solid square only in alpha. On black it vanishes; on white it is a black square.
    const W = 64;
    const px = Buffer.alloc(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        px[(y * W + x) * 4 + 3] = x >= 16 && x < 48 && y >= 16 && y < 48 ? 255 : 0;
    const input = u8(
      await sharp(px, { raw: { width: W, height: W, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const out = await re(input, createDocumentedImagesFake());
    expect(out.transparency).toBe("binary");
    const [white, black] = await Promise.all(
      out.scanRenditions.map((r) => sharp(renditionBytes(r)).greyscale().raw().toBuffer()),
    );
    const at = (b: Buffer, x: number, y: number) => b[y * W + x];
    expect(at(white, 4, 4)).toBeGreaterThan(240); // background: white
    expect(at(white, 32, 32)).toBeLessThan(16); // the square: visible
    expect(at(black, 4, 4)).toBeLessThan(16);
    expect(at(black, 32, 32)).toBeLessThan(16); // invisible on black: why both are required
  });

  it("opt-in pixelSource 'rgba' (type definitions only) gives the same pixels on the doc fake and is refused by local mode", async () => {
    const input = await hiddenAlphaImage(1, "png");
    const viaPng = await re(input, createDocumentedImagesFake());
    const viaRgba = await re(input, createDocumentedImagesFake(), { pixelSource: "rgba" });
    expect(sameBytes(viaPng.bytes, viaRgba.bytes)).toBe(true);
    expect(await code(re(input, createLocalModeImagesFake(), { pixelSource: "rgba" }))).toBe(
      "unreadable",
    );
  });
});

describe("cloudflare-images PoC: transparency preserved", () => {
  it.each(BINDINGS)(
    "PNG alpha kept; a lossy WEBP with alpha stays lossy WEBP with alpha (%s)",
    async (_n, make) => {
      const png = await re(await alphaPng(), make());
      expect([png.mime, png.hasAlpha]).toEqual(["image/png", true]);
      const webpIn = u8(
        await sharp(await alphaPng())
          .webp({ quality: 90 })
          .toBuffer(),
      );
      const webp = await re(webpIn, make());
      expect([webp.mime, webp.hasAlpha, webp.lossless, webp.width, webp.height]).toEqual([
        "image/webp",
        true,
        false,
        96,
        80,
      ]);
      const alphaIn = await sharp(webpIn).extractChannel(3).raw().toBuffer();
      const alphaOut = await sharp(webp.bytes).extractChannel(3).raw().toBuffer();
      let d = 0;
      for (let i = 0; i < alphaIn.length; i++) d += Math.abs(alphaIn[i] - alphaOut[i]);
      expect(d / alphaIn.length).toBeLessThan(2);
      await expectClean(webp.bytes);
    },
  );

  it("an opaque PNG is published as RGB (no alpha channel invented)", async () => {
    const out = await re(
      u8(await solid(80, 64, "#abcdef").png().toBuffer()),
      createDocumentedImagesFake(),
    );
    expect(out.hasAlpha).toBe(false);
    expect((await sharp(out.bytes).metadata()).channels).toBe(3);
  });
});

describe("cloudflare-images PoC: orientation 1-8", () => {
  const cases = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((o) =>
    (["jpeg", "png", "webp"] as const).map((f) => [o, f] as const),
  );

  it.each(cases)(
    "doc: orientation %i in a %s is applied with explicit transforms, then dropped",
    async (o, fmt) => {
      const input = await orientedCard(o, fmt);
      const images = createDocumentedImagesFake();
      const out = await re(input, images);
      expect(out.orientation).toBe(o);
      expect([out.width, out.height]).toEqual(o >= 5 ? [80, 120] : [120, 80]);
      const want = u8(await sharp(input).autoOrient().png().toBuffer());
      expect(await meanAbsDiff(out.bytes, want)).toBeLessThan(fmt === "jpeg" ? 6 : 0.001);
      await expectClean(out.bytes);
      const firstOutput = images.calls.find((c) => c.op === "output")!;
      expect(firstOutput.transforms).toEqual(ORIENTATION_TRANSFORMS[o]);
    },
  );

  it("local mode ignores flip: rotations (1, 3, 6, 8) come out right, mirrored orientations (2, 4, 5, 7) come out WRONG", async () => {
    // Documents a fidelity gap, not desired behaviour: Wrangler's offline mode cannot be used to validate orientation.
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const input = await orientedCard(o, "png");
      const out = await re(input, createLocalModeImagesFake());
      const want = u8(await sharp(input).autoOrient().png().toBuffer());
      const diff = await meanAbsDiff(out.bytes, want);
      if ([1, 3, 6, 8].includes(o)) expect(diff).toBe(0);
      else expect(diff).toBeGreaterThan(10);
    }
  });
});

describe("cloudflare-images PoC: oversized images and bombs", () => {
  it("a 49 MP PNG of a few KB is refused by the header, before any binding call", async () => {
    const bomb = u8(await solid(7000, 7000, "#000").png({ compressionLevel: 9 }).toBuffer());
    const images = createDocumentedImagesFake();
    expect(await code(re(bomb, images))).toBe("too_large");
    expect(images.calls).toHaveLength(0);
  });

  it("a forged JPEG header (60000 x 60000) is refused before any binding call", async () => {
    const j = u8(await solid(64, 64, "#000").jpeg().toBuffer());
    const k = Buffer.from(j).indexOf(Buffer.from([0xff, 0xc0]));
    const patched = j.slice();
    patched.set([0xea, 0x60, 0xea, 0x60], k + 5);
    const images = createDocumentedImagesFake();
    expect(["too_large", "unreadable"]).toContain(await code(re(patched, images)));
    expect(images.calls).toHaveLength(0);
  });

  it("the pixel path has its own lower cap (one RGBA frame must fit in the isolate)", async () => {
    const png = u8(await solid(300, 300, "#000").png().toBuffer());
    expect(
      await code(re(png, createDocumentedImagesFake(), { maxPixelPathPixels: 300 * 300 - 1 })),
    ).toBe("too_large");
    expect(
      await code(re(png, createDocumentedImagesFake(), { maxPixelPathPixels: 300 * 300 })),
    ).toBe("accepted");
    // a JPEG of the same size does not take the pixel path
    const jpg = u8(await solid(300, 300, "#000").jpeg().toBuffer());
    expect(await code(re(jpg, createDocumentedImagesFake(), { maxPixelPathPixels: 1 }))).toBe(
      "accepted",
    );
  });

  it("the binding's own area limit (9413) maps to too_large", async () => {
    const images = createDocumentedImagesFake({
      fail: (c) => (c.op === "output" ? new FakeImagesError(9413, "area") : null),
    });
    expect(await code(re(u8(await solid(64, 64, "#000").jpeg().toBuffer()), images))).toBe(
      "too_large",
    );
  });

  it("a PNG whose binding output decodes to more pixels than the cap is refused before inflating", async () => {
    const big = u8(await solid(200, 200, "#000").png().toBuffer());
    const images = createDocumentedImagesFake({
      tamper: (b, c) => (c.op === "output" && c.output?.format === "image/png" ? big : b),
    });
    expect(
      await code(
        re(u8(await solid(64, 64, "#000").png().toBuffer()), images, {
          maxPixelPathPixels: 64 * 64,
        }),
      ),
    ).toBe("too_large");
  });
});

describe("cloudflare-images PoC: malformed and unsupported files", () => {
  it.each([
    ["GIF", async () => u8(await solid(64, 64, "#f00").gif().toBuffer())],
    ["TIFF", async () => u8(await solid(64, 64, "#f00").tiff().toBuffer())],
    ["AVIF", async () => u8(await solid(64, 64, "#f00").avif().toBuffer())],
    [
      "SVG",
      async () => enc.encode('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>'),
    ],
    ["random bytes", async () => Uint8Array.from({ length: 512 }, (_, i) => (i * 37) & 255)],
    ["an empty file", async () => new Uint8Array(0)],
  ])("refuses %s as unsupported without calling the binding", async (_n, make) => {
    const images = createDocumentedImagesFake();
    expect(await code(re(await make(), images))).toBe("unsupported");
    expect(images.calls).toHaveLength(0);
  });

  it.each(BINDINGS)(
    "refuses a truncated JPEG and a PNG with a corrupt image stream (%s)",
    async (_n, make) => {
      const j = u8(await solid(96, 64, "#123").jpeg().toBuffer());
      expect(await code(re(j.subarray(0, j.length - 40), make()))).toBe("unreadable");
      const p = u8(await solid(96, 64, "#123").png().toBuffer());
      const corrupt = p.slice();
      const idat = Buffer.from(p).indexOf(Buffer.from("IDAT"));
      for (let i = idat + 6; i < idat + 20; i++) corrupt[i] ^= 0x5a;
      const len = (p[idat - 4] << 24) | (p[idat - 3] << 16) | (p[idat - 2] << 8) | p[idat - 1];
      corrupt.set(be32(crc(corrupt.subarray(idat, idat + 4 + len))), idat + 4 + len);
      expect(stripImageMetadata(corrupt).bytes.length).toBeGreaterThan(0); // the stripper does not see it: the decoder must
      expect(await code(re(corrupt, make()))).toBe("unreadable");
    },
  );
});

describe("cloudflare-images PoC: determinism", () => {
  it.each(BINDINGS)("the same upload gives the same bytes (%s)", async (name, make) => {
    for (const input of [
      u8(readFileSync("e2e/fixtures/exif/o6.jpg")),
      await alphaPng(),
      u8(
        await sharp(await alphaPng())
          .webp({ quality: 80 })
          .toBuffer(),
      ),
      // local mode cannot write lossless WEBP (see the fail-closed tests)
      ...(name === "doc" ? [await hiddenAlphaImage(1, "webp")] : []),
    ]) {
      const a = await re(input, make());
      const b = await re(input, make());
      expect(sameBytes(a.bytes, b.bytes)).toBe(true);
      expect(a.scanRenditions).toEqual(b.scanRenditions);
    }
  });

  it("re-encoding the output again is stable: PNG byte-identical (doc)", async () => {
    const once = await re(await alphaPng(), createDocumentedImagesFake());
    const twice = await re(once.bytes, createDocumentedImagesFake());
    expect(sameBytes(once.bytes, twice.bytes)).toBe(true);
  });
});

describe("cloudflare-images PoC: fails closed", () => {
  const jpeg = async () => u8(await solid(96, 64, "#406080").jpeg().toBuffer());
  const failOn = (op: "info" | "output", err: unknown): FakeHooks => ({
    fail: (c) => (c.op === op ? err : null),
  });

  it("no binding configured -> unavailable (held)", async () => {
    expect(await code(re(await jpeg(), undefined))).toBe("unavailable");
    expect(await code(re(await jpeg(), {}))).toBe("unavailable");
  });

  it.each([
    [
      "an error with no code (network, binding missing at runtime)",
      new Error("boom"),
      "unavailable",
    ],
    ["9422 quota reached", new FakeImagesError(9422, "quota"), "unavailable"],
    ["9432 legacy billing", new FakeImagesError(9432, "billing"), "unavailable"],
    ["9529 processing timeout", new FakeImagesError(9529, "timeout"), "unavailable"],
    ["9523 cannot process", new FakeImagesError(9523, "bad"), "unreadable"],
    ["9412 not an image", new FakeImagesError(9412, "html"), "unreadable"],
    ["an unknown code", new FakeImagesError(9999, "?"), "unreadable"],
  ])("binding error: %s", async (_n, err, want) => {
    for (const op of ["info", "output"] as const)
      expect(await code(re(await jpeg(), createDocumentedImagesFake(failOn(op, err))))).toBe(want);
  });

  it("a binding that does not answer in time -> unavailable", async () => {
    expect(
      await code(re(await jpeg(), createDocumentedImagesFake({ delayMs: 200 }), { timeoutMs: 20 })),
    ).toBe("unavailable");
  });

  it("a pass-through binding (returns what it was given) is refused", async () => {
    const images = createDocumentedImagesFake({ tamper: (_b, c) => c.input });
    expect(await code(re(await jpeg(), images))).toBe("unreadable");
  });

  it.each([
    [
      "an EXIF block",
      (b: Uint8Array) => jpegWithSegment(b, 0xe1, cat(enc.encode("Exif\0\0"), new Uint8Array(20))),
    ],
    [
      "an ICC profile",
      (b: Uint8Array) =>
        jpegWithSegment(b, 0xe2, cat(enc.encode("ICC_PROFILE\0"), new Uint8Array(20))),
    ],
    ["a comment", (b: Uint8Array) => jpegWithSegment(b, 0xfe, PAYLOAD)],
    ["trailing data", (b: Uint8Array) => cat(b, PAYLOAD)],
  ])("a JPEG output that carries %s is refused", async (_n, tamper) => {
    const images = createDocumentedImagesFake({
      tamper: (b, c) => (c.op === "output" ? tamper(b) : b),
    });
    expect(await code(re(await jpeg(), images))).toBe("unreadable");
  });

  it("a WEBP output with an ICC/EXIF flag or an extra chunk is refused", async () => {
    const webp = u8(await solid(96, 64, "#00ff00").webp({ quality: 80 }).toBuffer());
    for (const tamper of [
      (b: Uint8Array) =>
        riff(
          cat(
            wchunk("VP8X", Uint8Array.from([0x20, 0, 0, 0, 95, 0, 0, 63, 0, 0])),
            wchunk("ICCP", PAYLOAD),
            b.subarray(12),
          ),
        ),
      (b: Uint8Array) => riff(cat(b.subarray(12), wchunk("XMP ", PAYLOAD))),
    ]) {
      const images = createDocumentedImagesFake({
        tamper: (b, c) => (c.op === "output" ? tamper(b) : b),
      });
      expect(await code(re(webp, images))).toBe("unreadable");
    }
  });

  it("wrong content type, wrong output type or size, or .info() disagreeing with the header is refused", async () => {
    const png = u8(await solid(10, 10, "#000").png().toBuffer());
    const hooks: FakeHooks[] = [
      { contentType: () => "image/png" },
      { tamper: (b, c) => (c.op === "output" ? png : b) },
      { info: (r) => ({ ...(r as any), width: 1 }) },
      { info: (r) => ({ ...(r as any), format: "image/png" }) },
      // the first .info() (of the input) is right, the read-back of the output is not
      (() => {
        let n = 0;
        return { info: (r: any) => (n++ === 0 ? r : { ...r, height: 1 }) };
      })(),
    ];
    for (const h of hooks)
      expect(await code(re(await jpeg(), createDocumentedImagesFake(h)))).toBe("unreadable");
  });

  it("a lossless WEBP that comes back lossy is refused (Wrangler local mode ignores quality=100)", async () => {
    const input = u8(await solid(96, 64, "#00ff00").webp({ lossless: true }).toBuffer());
    expect(await code(re(input, createDocumentedImagesFake()))).toBe("accepted");
    expect(await code(re(input, createLocalModeImagesFake()))).toBe("unreadable");
  });
});

describe("cloudflare-images PoC: pixel-path cost (pure JS PNG decode + quantise + encode, Node, not workerd)", () => {
  it("measures a 2 MP RGBA picture end to end on the doc fake (logged, loose bound)", async () => {
    const w = 1600;
    const h = 1250;
    const raw = Buffer.alloc(w * h * 4);
    for (let i = 0; i < raw.length; i += 4) {
      const x = (i / 4) % w;
      raw[i] = x & 255;
      raw[i + 1] = (i >> 10) & 255;
      raw[i + 2] = (x * 3) & 255;
      raw[i + 3] = x % 7 === 0 ? 128 : 255;
    }
    const input = u8(
      await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const t0 = performance.now();
    const out = await re(input, createDocumentedImagesFake());
    const ms = performance.now() - t0;
    console.info(
      `[pixel-path] ${w}x${h} RGBA: ${ms.toFixed(0)} ms total (incl. fake binding), ${out.bytes.length} bytes out`,
    );
    expect(ms).toBeLessThan(20_000);
  });
});
