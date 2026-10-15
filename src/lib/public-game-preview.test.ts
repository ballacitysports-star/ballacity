import { describe, expect, it } from "vitest";
import { isPublicGamePreviewPath, isPublicTeamPreviewPath } from "./public-game-preview";

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

describe("isPublicTeamPreviewPath", () => {
  it("matches a single team page", () => {
    expect(isPublicTeamPreviewPath("/teams/abc123")).toBe(true);
  });
  it("excludes create, sub-pages and the bare prefix", () => {
    expect(isPublicTeamPreviewPath("/teams/create")).toBe(false);
    expect(isPublicTeamPreviewPath("/teams")).toBe(false);
    expect(isPublicTeamPreviewPath("/teams/abc123/roster")).toBe(false);
    expect(isPublicTeamPreviewPath("/teams/abc123/manage")).toBe(false);
  });
});
