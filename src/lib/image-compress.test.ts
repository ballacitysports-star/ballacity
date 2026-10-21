import { describe, expect, it } from "vitest";
import {
  MAX_EDGE,
  MIN_BYTES,
  compressImageForUpload,
  fitWithin,
  isCompressibleImage,
  renameForType,
} from "./image-compress";

describe("fitWithin", () => {
  it("scales a landscape photo so its long side is the limit", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_EDGE, height: 1440 });
  });

  it("scales a portrait photo the same way", () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1440, height: MAX_EDGE });
  });

  it("never enlarges a picture that already fits", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_EDGE, MAX_EDGE)).toEqual({ width: MAX_EDGE, height: MAX_EDGE });
  });

  it("keeps a very thin picture at least one pixel wide", () => {
    expect(fitWithin(100_000, 10)).toEqual({ width: MAX_EDGE, height: 1 });
  });

  it("honours a different limit", () => {
    expect(fitWithin(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
  });
});

describe("isCompressibleImage", () => {
  it("covers JPEG and PNG only", () => {
    expect(isCompressibleImage({ type: "image/jpeg" })).toBe(true);
    expect(isCompressibleImage({ type: "image/png" })).toBe(true);
  });

  it("leaves everything that would lose something alone", () => {
    for (const type of [
      "image/gif", // animation
      "image/svg+xml",
      "image/webp",
      "image/heic",
      "video/mp4",
      "application/pdf",
      "",
    ]) {
      expect(isCompressibleImage({ type }), type).toBe(false);
    }
  });
});

describe("renameForType", () => {
  it("changes the extension when a PNG becomes a JPEG", () => {
    expect(renameForType("Screenshot 2026.png", "image/png", "image/jpeg")).toBe(
      "Screenshot 2026.jpg",
    );
    expect(renameForType("a.b.PNG", "image/png", "image/jpeg")).toBe("a.b.jpg");
  });

  it("keeps the name when the format is unchanged", () => {
    expect(renameForType("IMG_0042.JPG", "image/jpeg", "image/jpeg")).toBe("IMG_0042.JPG");
    expect(renameForType("logo.png", "image/png", "image/png")).toBe("logo.png");
  });

  it("copes with a name that has no extension", () => {
    expect(renameForType("camera", "image/png", "image/jpeg")).toBe("camera.jpg");
  });
});

describe("compressImageForUpload — when it leaves the file alone", () => {
  const big = (type: string, name = "f") =>
    new File([new Uint8Array(MIN_BYTES + 1)], name, { type });

  it("returns the very same file for types it does not handle", async () => {
    for (const type of ["image/gif", "application/pdf", "video/mp4", "image/heic"]) {
      const f = big(type);
      expect(await compressImageForUpload(f), type).toBe(f);
    }
  });

  it("returns a small image as it is", async () => {
    const f = new File([new Uint8Array(MIN_BYTES)], "small.jpg", { type: "image/jpeg" });
    expect(await compressImageForUpload(f)).toBe(f);
  });

  it("returns the original, without throwing, where there is no browser to decode it", async () => {
    // Node has no createImageBitmap or document, as with an old browser.
    const f = big("image/jpeg", "photo.jpg");
    expect(await compressImageForUpload(f)).toBe(f);
  });
});
