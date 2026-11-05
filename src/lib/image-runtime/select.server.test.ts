import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ImageReencodeError,
  reencodeImage,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import {
  imageReencoderFromProcessEnv,
  parseImageRuntime,
  selectImageReencoder,
} from "./select.server";
import { reencodeResultProblem, requiredScanRenditions } from "./reencode-contract";
import { createDocumentedImagesFake } from "./test-support/fake-images-binding";
import { alphaPng, hiddenAlphaImage, solid, u8 } from "./test-support/fixtures";

const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImageReencodeError);
    return (e as ImageReencodeError).code;
  }
  return "accepted";
};

describe("IMAGE_RUNTIME selector", () => {
  it("defaults to disabled, and any unknown value is disabled", () => {
    for (const v of [undefined, "", "sharp", "CLOUDFLARE-IMAGES", "enabled", " disabled "])
      expect(parseImageRuntime(v)).toBe("disabled");
    expect(parseImageRuntime("sharp-node")).toBe("sharp-node");
    expect(parseImageRuntime("sharp-in-process")).toBe("sharp-in-process");
    expect(parseImageRuntime("cloudflare-images")).toBe("cloudflare-images");
  });

  it("disabled fails closed with 'unavailable' (promotion holds: nothing published)", async () => {
    const jpg = u8(await solid(96, 64, "#123").jpeg().toBuffer());
    const { runtime, reencode } = selectImageReencoder({});
    expect(runtime).toBe("disabled");
    expect(await fails(reencode(jpg))).toBe("unavailable");
  });

  it("a selected runtime that is not configured fails closed too", async () => {
    const jpg = u8(await solid(96, 64, "#123").jpeg().toBuffer());
    expect(
      await fails(selectImageReencoder({ IMAGE_RUNTIME: "cloudflare-images" }).reencode(jpg)),
    ).toBe("unavailable");
    for (const env of [
      { IMAGE_RUNTIME: "sharp-node" },
      {
        IMAGE_RUNTIME: "sharp-node",
        IMAGE_PROCESSOR_URL: "https://p.example",
        IMAGE_PROCESSOR_SECRET: "short",
      },
      {
        IMAGE_RUNTIME: "sharp-node",
        IMAGE_PROCESSOR_URL: "http://p.example",
        IMAGE_PROCESSOR_SECRET: "k".repeat(40),
      },
    ])
      expect(await fails(selectImageReencoder(env).reencode(jpg))).toBe("unavailable");
  });

  it("cloudflare-images with a binding re-encodes (doc fake)", async () => {
    const jpg = u8(await solid(96, 64, "#123").jpeg().toBuffer());
    const { runtime, reencode } = selectImageReencoder({
      IMAGE_RUNTIME: "cloudflare-images",
      IMAGES: createDocumentedImagesFake(),
    });
    expect(runtime).toBe("cloudflare-images");
    expect((await reencode(jpg)).mime).toBe("image/jpeg");
  });

  it("sharp-in-process runs the canonical re-encoder (Node hosts only)", async () => {
    const out = await selectImageReencoder({ IMAGE_RUNTIME: "sharp-in-process" }).reencode(
      await alphaPng(),
    );
    expect([out.transparency, out.scanRenditions.length]).toEqual(["partial", 3]);
  });

  it("F09: every runtime's result is checked against the contract; a broken one is held (unavailable), never returned", async () => {
    const input = await alphaPng();
    const real = await reencodeImage(input);
    const broken: Array<(r: ReencodeResult) => unknown> = [
      (r) => ({ ...r, scanRenditions: r.scanRenditions.slice(2) }), // white and black dropped
      (r) => ({ ...r, transparency: "binary" }), // three renditions declared as two
      (r) => ({ ...r, hasAlpha: false }), // transparency without an alpha channel
      (r) => {
        const { scanRenditions: _s, transparency: _t, ...rest } = r;
        return { ...rest, alphaRemovedScanTarget: r.scanRenditions[2] }; // contract v1
      },
      (r) => ({
        ...r,
        scanRenditions: ["data:image/png;base64,AAAA", ...r.scanRenditions.slice(1)],
      }),
    ];
    for (const breakIt of broken) {
      const { reencode } = selectImageReencoder(
        { IMAGE_RUNTIME: "sharp-in-process" },
        { inProcess: async () => breakIt(real) as ReencodeResult },
      );
      expect(await fails(reencode(input))).toBe("unavailable");
    }
  });

  it("F09: both runtimes give the same rendition set for the same picture (sharp, Cloudflare doc fake)", async () => {
    for (const input of [
      await alphaPng(),
      await hiddenAlphaImage(0, "png"),
      u8(await solid(80, 64, "#abcdef").png().toBuffer()),
      u8(readFileSync("e2e/fixtures/exif/o6.jpg")),
    ]) {
      const sharpOut = await selectImageReencoder({ IMAGE_RUNTIME: "sharp-in-process" }).reencode(
        input,
      );
      const cfOut = await selectImageReencoder({
        IMAGE_RUNTIME: "cloudflare-images",
        IMAGES: createDocumentedImagesFake(),
      }).reencode(input);
      expect(cfOut.transparency).toBe(sharpOut.transparency);
      expect(cfOut.scanRenditions).toHaveLength(requiredScanRenditions(sharpOut.transparency));
      expect(reencodeResultProblem(cfOut)).toBeNull();
      expect(reencodeResultProblem(sharpOut)).toBeNull();
    }
  });

  it("F09: the server functions read the runtime from the environment; unset means disabled (held, nothing published)", async () => {
    const jpg = u8(await solid(96, 64, "#123").jpeg().toBuffer());
    expect(imageReencoderFromProcessEnv({}).runtime).toBe("disabled");
    expect(await fails(imageReencoderFromProcessEnv({}).reencode(jpg))).toBe("unavailable");
    expect(
      imageReencoderFromProcessEnv({
        IMAGE_RUNTIME: "sharp-node",
        IMAGE_PROCESSOR_URL: "https://p.example",
        IMAGE_PROCESSOR_SECRET: "k".repeat(40),
      }).runtime,
    ).toBe("sharp-node");
    // the Images binding is not plumbed from the Worker env: cloudflare-images stays closed
    expect(
      await fails(
        imageReencoderFromProcessEnv({ IMAGE_RUNTIME: "cloudflare-images" }).reencode(jpg),
      ),
    ).toBe("unavailable");
  });

  it("F09: both upload paths take the configured runtime (no in-process default)", () => {
    const src = readFileSync("src/lib/image-uploads.functions.ts", "utf8");
    expect(src.match(/reencode: imageReencoderFromProcessEnv\(\)\.reencode/g)).toHaveLength(2);
    for (const f of [
      "src/lib/image-promotion.server.ts",
      "src/lib/image-finalize-direct.server.ts",
    ]) {
      const lib = readFileSync(f, "utf8");
      expect(lib).not.toMatch(/deps\.reencode \?\?/);
      expect(lib).not.toMatch(/\breencodeImage\b/);
    }
  });
});
