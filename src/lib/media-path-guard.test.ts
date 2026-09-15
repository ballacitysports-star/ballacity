import { describe, expect, it } from "vitest";
import {
  assertOwnedMediaPath,
  isOwnedMediaPath,
  ownedMediaPathOrNull,
} from "@/lib/media-path-guard";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("media path guard", () => {
  it("accepts a path inside the owner's own folder", () => {
    expect(isOwnedMediaPath(ME, `${ME}/clip.mp4`)).toBe(true);
    expect(isOwnedMediaPath(ME, `${ME}/frames/frame-1.jpg`)).toBe(true);
    expect(() => assertOwnedMediaPath(ME, `${ME}/clip.mp4`)).not.toThrow();
  });

  it("rejects another user's folder", () => {
    expect(isOwnedMediaPath(ME, `${OTHER}/private.mp4`)).toBe(false);
    expect(() => assertOwnedMediaPath(ME, `${OTHER}/private.mp4`)).toThrow(/does not belong/i);
  });

  it("rejects traversal segments", () => {
    expect(isOwnedMediaPath(ME, `${ME}/../${OTHER}/private.mp4`)).toBe(false);
    expect(isOwnedMediaPath(ME, `../${ME}/clip.mp4`)).toBe(false);
    expect(() => assertOwnedMediaPath(ME, `${ME}/../x.mp4`)).toThrow();
  });

  it("rejects empty segments and bare filenames", () => {
    expect(isOwnedMediaPath(ME, "clip.mp4")).toBe(false);
    expect(isOwnedMediaPath(ME, `/${ME}/clip.mp4`)).toBe(false);
    expect(isOwnedMediaPath(ME, `${ME}//clip.mp4`)).toBe(false);
  });

  it("treats a missing path as nothing to sign", () => {
    expect(isOwnedMediaPath(ME, null)).toBe(true);
    expect(isOwnedMediaPath(ME, undefined)).toBe(true);
    expect(isOwnedMediaPath(ME, "")).toBe(true);
    expect(() => assertOwnedMediaPath(ME, null)).not.toThrow();
  });

  it("ownedMediaPathOrNull degrades instead of throwing", () => {
    expect(ownedMediaPathOrNull(ME, `${ME}/clip.mp4`)).toBe(`${ME}/clip.mp4`);
    expect(ownedMediaPathOrNull(ME, `${OTHER}/clip.mp4`)).toBeNull();
    expect(ownedMediaPathOrNull(ME, null)).toBeNull();
  });
});
