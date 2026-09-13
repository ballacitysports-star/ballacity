import { describe, expect, it } from "vitest";
import { imageSrcSet, imageThumb, imageVariant, isTransformableImageUrl } from "./image-variants";

const PUBLIC_URL = "https://proj.supabase.co/storage/v1/object/public/org-covers/user-1/photo.jpg";
const SIGNED_URL =
  "https://proj.supabase.co/storage/v1/object/sign/game-covers/user-1/photo.jpg?token=abc.def";

describe("image-variants", () => {
  it("detects transformable storage URLs", () => {
    expect(isTransformableImageUrl(PUBLIC_URL)).toBe(true);
    expect(isTransformableImageUrl(SIGNED_URL)).toBe(true);
    expect(isTransformableImageUrl("/src/assets/sport-soccer.jpg")).toBe(false);
    expect(isTransformableImageUrl("data:image/png;base64,AAA")).toBe(false);
    expect(isTransformableImageUrl(null)).toBe(false);
  });

  it("rewrites public objects to the render endpoint", () => {
    const url = new URL(imageVariant(PUBLIC_URL, { width: 640 }));
    expect(url.pathname).toBe("/storage/v1/render/image/public/org-covers/user-1/photo.jpg");
    expect(url.searchParams.get("width")).toBe("640");
    expect(url.searchParams.get("resize")).toBe("contain");
    expect(url.searchParams.get("quality")).toBe("74");
  });

  it("preserves the signed token for private buckets", () => {
    const url = new URL(imageThumb(SIGNED_URL, 64));
    expect(url.pathname).toBe("/storage/v1/render/image/sign/game-covers/user-1/photo.jpg");
    expect(url.searchParams.get("token")).toBe("abc.def");
    expect(url.searchParams.get("height")).toBe("64");
    expect(url.searchParams.get("resize")).toBe("cover");
  });

  it("leaves non-storage sources untouched", () => {
    expect(imageVariant("/src/assets/sport-soccer.jpg", { width: 320 })).toBe(
      "/src/assets/sport-soccer.jpg",
    );
    expect(imageSrcSet("/src/assets/sport-soccer.jpg")).toBeUndefined();
  });

  it("builds a srcSet with crop heights when an aspect is given", () => {
    const set = imageSrcSet(PUBLIC_URL, [320, 640], { aspect: 16 / 9 })!;
    const entries = set.split(", ");
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatch(/ 640w$/);
    const first = new URL(entries[0].split(" ")[0]);
    expect(first.searchParams.get("height")).toBe("180");
    expect(first.searchParams.get("resize")).toBe("cover");
  });

  it("clamps quality to a sane range", () => {
    const url = new URL(imageVariant(PUBLIC_URL, { width: 100, quality: 5 }));
    expect(url.searchParams.get("quality")).toBe("20");
  });
});
