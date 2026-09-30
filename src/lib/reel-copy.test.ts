import { describe, expect, it } from "vitest";
import { formatPostCopy, sampleOverlayText, suggestReelTitles } from "@/lib/reel-copy";

// Local noon, so the weekday is the same in every timezone the suite runs in.
const SUNDAY = new Date(2026, 8, 20, 12);

describe("suggestReelTitles", () => {
  it("leads with the linked game, then the day and sport", () => {
    expect(
      suggestReelTitles({
        sport: "Basketball",
        gameTitle: "Tuesday Night Run",
        date: SUNDAY,
        vibe: "hype",
      }),
    ).toEqual([
      "Tuesday Night Run highlights",
      "Sunday basketball highlights",
      "Basketball · Best plays",
    ]);
  });

  it("follows the chosen vibe", () => {
    const [, , third] = suggestReelTitles({ sport: "Soccer", date: SUNDAY, vibe: "broadcast" });
    expect(suggestReelTitles({ sport: "Soccer", date: SUNDAY, vibe: "broadcast" })[0]).toBe(
      "Sunday soccer recap",
    );
    expect(third).toBe("Soccer recap · Sep 20");
  });

  it("works with nothing known about the clip", () => {
    expect(suggestReelTitles({})).toEqual(["Pickup · Best plays", "My pickup highlights"]);
  });

  it("ignores an unparseable date", () => {
    expect(suggestReelTitles({ sport: "Tennis", date: "not a date", vibe: "cinematic" })).toEqual([
      "Tennis · Moments",
      "My tennis film",
    ]);
  });

  it("never offers a title longer than the field allows", () => {
    const [first] = suggestReelTitles({ gameTitle: "x".repeat(200) });
    expect(first.length).toBeLessThanOrEqual(120);
  });
});

describe("sampleOverlayText", () => {
  it("writes the sample the way each theme asks the AI to", () => {
    expect(sampleOverlayText("scoreboard", "Basketball")).toBe("basketball · fast break bucket");
    expect(sampleOverlayText("minimal", "Basketball")).toBe("fast break");
    expect(sampleOverlayText("bold", "Soccer")).toBe("top corner!");
    expect(sampleOverlayText("retro", "Tennis")).toBe("Passing Shot Winner");
    expect(sampleOverlayText("none", "Tennis")).toBe("");
    expect(sampleOverlayText("scoreboard", null)).toBe("key play");
  });
});

describe("formatPostCopy", () => {
  it("joins the caption and hashtags", () => {
    expect(formatPostCopy("Cooking at the Y", ["hoops", "#pickup"])).toBe(
      "Cooking at the Y\n\n#hoops #pickup",
    );
  });

  it("copes with a missing caption or hashtags", () => {
    expect(formatPostCopy(null, ["hoops"])).toBe("#hoops");
    expect(formatPostCopy("Just the caption", null)).toBe("Just the caption");
    expect(formatPostCopy("", [])).toBe("");
  });
});
