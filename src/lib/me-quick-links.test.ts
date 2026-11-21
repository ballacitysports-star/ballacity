import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { meQuickLinks } from "./me-quick-links";

const AVAILABILITY = { to: "/availability", label: "My availability" };

describe("Me tab creator shortcuts (P2-9)", () => {
  it("shows My availability, Hosting and Reel Studio to a member who may use all three", () => {
    expect(meQuickLinks({ canHost: true, canUploadVideo: true, parentMode: false })).toEqual([
      AVAILABILITY,
      { to: "/host", label: "Hosting" },
      { to: "/reels", label: "Reel Studio" },
    ]);
  });

  it("hides Hosting from a member who may not host (for example under 13)", () => {
    expect(
      meQuickLinks({ canHost: false, canUploadVideo: true, parentMode: false }).map((l) => l.to),
    ).toEqual(["/availability", "/reels"]);
  });

  it("hides Reel Studio without video upload; parent mode hides Reel Studio and My availability", () => {
    expect(meQuickLinks({ canHost: true, canUploadVideo: false, parentMode: false })).toEqual([
      AVAILABILITY,
      { to: "/host", label: "Hosting" },
    ]);
    expect(meQuickLinks({ canHost: true, canUploadVideo: true, parentMode: true })).toEqual([
      { to: "/host", label: "Hosting" },
    ]);
    expect(meQuickLinks({ canHost: false, canUploadVideo: false, parentMode: false })).toEqual([
      AVAILABILITY,
    ]);
    expect(meQuickLinks({ canHost: false, canUploadVideo: false, parentMode: true })).toEqual([]);
  });

  it("WP 4.1: the Me tab links My availability & invitations as a full-size target", () => {
    const src = readFileSync("src/routes/_tabs.profile.tsx", "utf8");
    expect(src).toContain('to="/availability" className={cn(channelPillClass(), "min-h-11")}');
  });

  it("the Me tab renders them from the policy engine's answers", () => {
    const src = readFileSync("src/routes/_tabs.profile.tsx", "utf8");
    // Both wait for the age status: before it loads the engine answers "allowed".
    expect(src).toContain("const statusKnown = childStatus.isSuccess;");
    expect(src).toContain('canHost: statusKnown && childStatus.can("game_hosting").allowed');
    expect(src).toContain('canUploadVideo: statusKnown && childStatus.can("video_upload").allowed');
  });

  it("the Reels header has a labelled Studio link next to the post button", () => {
    const src = readFileSync("src/routes/_tabs.highlights.tsx", "utf8");
    const header = src.slice(src.indexOf("<header"), src.indexOf("</header>"));
    expect(header).toMatch(/>\s*Studio\s*</);
  });
});
