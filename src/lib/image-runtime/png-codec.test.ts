import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PngCodecError, decodePngToRgba, encodePngFromRgba, pngChunkTypes } from "./png-codec";
import { be32, cat, crc, pchunk, u8 } from "./test-support/fixtures";

/** The pure-JS PNG codec used by the Cloudflare Images PoC's pixel path. sharp is the reference decoder here. */

const W = 37;
const H = 23;
function rgba(): Buffer {
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < px.length; i += 4) {
    const x = (i / 4) % W;
    const y = Math.floor(i / 4 / W);
    px[i] = (x * 7) & 255;
    px[i + 1] = (y * 11) & 255;
    px[i + 2] = (x * y) & 255;
    px[i + 3] = (x * 13 + y) & 255;
  }
  return px;
}

async function reference(png: Uint8Array) {
  return sharp(png).ensureAlpha().raw({ depth: "uchar" }).toBuffer();
}

describe("png-codec: decoding matches sharp", () => {
  const raw = rgba();
  const base = () => sharp(raw, { raw: { width: W, height: H, channels: 4 } });
  it.each([
    ["RGBA 8-bit, adaptive filters", () => base().png({ adaptiveFiltering: true })],
    ["RGB 8-bit", () => base().removeAlpha().png()],
    ["grey 8-bit", () => base().removeAlpha().greyscale().png()],
    ["grey+alpha 8-bit", () => base().greyscale().png()],
    ["palette with tRNS", () => base().png({ palette: true, colours: 64, dither: 0 })],
    ["palette 2-bit", () => base().removeAlpha().png({ palette: true, colours: 4, dither: 0 })],
    ["RGBA 16-bit", () => base().toColourspace("rgb16").png()],
  ])("%s", async (_n, make) => {
    const png = u8(await make().toBuffer());
    const img = await decodePngToRgba(png, { maxPixels: W * H });
    expect([img.width, img.height]).toEqual([W, H]);
    expect(Buffer.compare(Buffer.from(img.data), await reference(png))).toBe(0);
  });
});

describe("png-codec: encoding", () => {
  it("round-trips RGBA and RGB exactly, writes only IHDR/IDAT/IEND, and is deterministic", async () => {
    const image = { width: W, height: H, data: new Uint8Array(rgba()) };
    const a = await encodePngFromRgba(image, 4);
    const b = await encodePngFromRgba(image, 4);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    expect(pngChunkTypes(a)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(Buffer.compare(await sharp(a).raw().toBuffer(), Buffer.from(image.data))).toBe(0);
    const rgb = await encodePngFromRgba(image, 3);
    const m = await sharp(rgb).metadata();
    expect([m.channels, m.hasAlpha]).toEqual([3, false]);
    const back = await sharp(rgb).raw().toBuffer();
    for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3)
      expect([back[j], back[j + 1], back[j + 2]]).toEqual([
        image.data[i],
        image.data[i + 1],
        image.data[i + 2],
      ]);
  });

  it("splits IDAT at a fixed size for large images", async () => {
    const w = 1024;
    const h = 1024;
    const data = new Uint8Array(w * h * 4);
    let s = 1;
    for (let i = 0; i < data.length; i++)
      data[i] = (s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 24; // noise: incompressible
    const png = await encodePngFromRgba({ width: w, height: h, data }, 4);
    expect(pngChunkTypes(png)!.filter((t) => t === "IDAT").length).toBeGreaterThan(1);
    const back = await decodePngToRgba(png, { maxPixels: w * h });
    expect(Buffer.compare(Buffer.from(back.data), Buffer.from(data))).toBe(0);
  });
});

describe("png-codec: refuses (the caller fails closed)", () => {
  const good = async () =>
    u8(
      await sharp(rgba(), { raw: { width: W, height: H, channels: 4 } })
        .png()
        .toBuffer(),
    );
  const refuse = async (bytes: Uint8Array, maxPixels = W * H) => {
    try {
      await decodePngToRgba(bytes, { maxPixels });
    } catch (e) {
      expect(e).toBeInstanceOf(PngCodecError);
      return (e as PngCodecError).kind;
    }
    return "decoded";
  };

  it("over the pixel cap, before inflating", async () => {
    expect(await refuse(await good(), W * H - 1)).toBe("too_large");
  });

  it("a bad CRC, a truncated file, missing IEND", async () => {
    const p = await good();
    const bad = p.slice();
    bad[40] ^= 1;
    expect(await refuse(bad)).toBe("malformed");
    expect(await refuse(p.subarray(0, p.length - 30))).toBe("malformed");
    expect(await refuse(p.subarray(0, p.length - 12))).toBe("malformed");
  });

  it("an interlaced PNG", async () => {
    const p = u8(
      await sharp(rgba(), { raw: { width: W, height: H, channels: 4 } })
        .png({ progressive: true })
        .toBuffer(),
    );
    expect(await refuse(p)).toBe("malformed");
  });

  it("image data shorter or longer than the header says", async () => {
    const p = await good();
    // claim one more row than the data holds
    const tall = p.slice();
    tall.set(be32(H + 1), 20);
    tall.set(be32(crc(tall.subarray(12, 29))), 29);
    expect(await refuse(tall, W * (H + 1))).toBe("malformed");
    // claim one row fewer: the data runs past the last row
    const short = p.slice();
    short.set(be32(H - 1), 20);
    short.set(be32(crc(short.subarray(12, 29))), 29);
    expect(await refuse(short)).toBe("malformed");
  });

  it("an unknown critical chunk", async () => {
    const p = await good();
    expect(
      await refuse(cat(p.subarray(0, 33), pchunk("ZZZZ", new Uint8Array(4)), p.subarray(33))),
    ).toBe("malformed");
  });
});
