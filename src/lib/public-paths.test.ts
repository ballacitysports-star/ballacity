import { describe, expect, it } from "vitest";
import { isPublicGamePath } from "./public-paths";

describe("isPublicGamePath", () => {
  it("opens a single game's page", () => {
    expect(isPublicGamePath("/games/abc123")).toBe(true);
    expect(isPublicGamePath("/games/abc123/")).toBe(true);
    expect(isPublicGamePath("/games/6f1c2d3e-0000-4000-8000-123456789abc")).toBe(true);
  });

  it("keeps a game's sub-pages behind sign-in", () => {
    expect(isPublicGamePath("/games/abc123/pay")).toBe(false);
    expect(isPublicGamePath("/games/abc123/payment-setup")).toBe(false);
  });

  it("does not open the games root or other areas", () => {
    expect(isPublicGamePath("/games")).toBe(false);
    expect(isPublicGamePath("/games/")).toBe(false);
    expect(isPublicGamePath("/feed")).toBe(false);
    expect(isPublicGamePath("/teams/abc123")).toBe(false);
    expect(isPublicGamePath("/mygames/abc123")).toBe(false);
  });
});
