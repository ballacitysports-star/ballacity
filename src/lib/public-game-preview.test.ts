import { describe, expect, it } from "vitest";
import { isPublicGamePreviewPath } from "./public-game-preview";

describe("isPublicGamePreviewPath", () => {
  it("matches a single game page", () => {
    expect(isPublicGamePreviewPath("/games/abc123")).toBe(true);
    expect(isPublicGamePreviewPath("/games/abc123/")).toBe(true);
  });
  it("does not match sub-pages or the bare prefix", () => {
    expect(isPublicGamePreviewPath("/games")).toBe(false);
    expect(isPublicGamePreviewPath("/games/")).toBe(false);
    expect(isPublicGamePreviewPath("/games/abc123/pay")).toBe(false);
    expect(isPublicGamePreviewPath("/games/abc123/payment-setup")).toBe(false);
  });
});
