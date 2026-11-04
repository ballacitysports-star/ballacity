import { describe, expect, it } from "vitest";
import { ImageReencodeError } from "@/lib/image-reencode.server";
import { parseImageRuntime, selectImageReencoder } from "./select.server";
import { createDocumentedImagesFake } from "./test-support/fake-images-binding";
import { solid, u8 } from "./test-support/fixtures";

const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImageReencodeError);
    return (e as ImageReencodeError).code;
  }
  return "accepted";
};

describe("IMAGE_RUNTIME seam (not wired into the app)", () => {
  it("defaults to disabled, and any unknown value is disabled", () => {
    for (const v of [undefined, "", "sharp", "CLOUDFLARE-IMAGES", "enabled", " disabled "])
      expect(parseImageRuntime(v)).toBe("disabled");
    expect(parseImageRuntime("sharp-node")).toBe("sharp-node");
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
});
