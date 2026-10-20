import { describe, expect, it } from "vitest";
import { buildCaption, buildGameShare, normalizeHashtags, platformShareUrl } from "../social-share";

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
  it("builds game share content with the canonical link and no venue", () => {
    const content = buildGameShare(
      { id: "g1", title: "Sunday Run", sport: "Flag Football" },
      "Sun, Oct 25 · 9:00 AM",
      "https://ballacity.com",
    );
    expect(content.url).toBe("https://ballacity.com/games/g1");
    expect(buildCaption(content)).toBe(
      "Come play: Sunday Run · Sun, Oct 25 · 9:00 AM\n#BallaCity #FlagFootball",
    );
  });
  it("shares a game without a sport tag when none is known", () => {
    const content = buildGameShare({ id: "g2", title: "Open Gym" }, "Tonight", "https://x.test");
    expect(buildCaption(content)).toBe("Come play: Open Gym · Tonight\n#BallaCity");
  });
  it("truncates long X text", () => {
    const long = { ...c, text: "a".repeat(500) };
    const text = decodeURIComponent(platformShareUrl("x", long).split("text=")[1].split("&url")[0]);
    expect(text.length).toBeLessThanOrEqual(220);
  });
});
