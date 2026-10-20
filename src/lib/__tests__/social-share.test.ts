import { describe, expect, it } from "vitest";
import {
  buildCaption,
  normalizeHashtags,
  platformShareUrl,
  reelDownloadName,
} from "../social-share";

const c = {
  title: "T",
  text: "Big win today",
  url: "https://x.test/a?b=1",
  hashtags: ["#hoops", "Hoops", "bad tag!"],
};

describe("social-share", () => {
  it("normalizes and dedupes hashtags", () => {
    expect(normalizeHashtags(["#a", "A", "b c", ""])).toEqual(["#a", "#bc"]);
  });
  it("builds a caption with BallaCity tag", () => {
    expect(buildCaption(c)).toBe("Big win today\n#BallaCity #hoops #badtag");
    expect(buildCaption(c, { withUrl: true }).endsWith(c.url)).toBe(true);
  });
  it("encodes platform URLs", () => {
    expect(platformShareUrl("x", c)).toContain("url=https%3A%2F%2Fx.test%2Fa%3Fb%3D1");
    expect(platformShareUrl("facebook", c)).toContain("u=https%3A%2F%2Fx.test");
    expect(platformShareUrl("whatsapp", c)).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
  it("truncates long X text", () => {
    const long = { ...c, text: "a".repeat(500) };
    const text = decodeURIComponent(platformShareUrl("x", long).split("text=")[1].split("&url")[0]);
    expect(text.length).toBeLessThanOrEqual(220);
  });
  it("builds safe reel download names", () => {
    expect(reelDownloadName("Big Win! Café 3-pointer", "u/abc/clip.MOV")).toBe(
      "big-win-cafe-3-pointer.mov",
    );
    expect(reelDownloadName("🔥🔥", "u/abc/clip")).toBe("ballacity-reel.mp4");
    expect(reelDownloadName("a".repeat(100), "x.mp4")).toBe(`${"a".repeat(60)}.mp4`);
  });
});
