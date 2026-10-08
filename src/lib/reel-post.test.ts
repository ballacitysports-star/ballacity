import { describe, expect, it } from "vitest";
import {
  captionChoices,
  cleanHashtags,
  normalizePostPackage,
  reelPhase,
  sanitizePostCopy,
} from "@/lib/reel-post";

describe("reelPhase", () => {
  it("walks a reel through its life", () => {
    expect(reelPhase({ status: "processing" })).toBe("processing");
    expect(reelPhase({ status: "failed", is_draft: true })).toBe("failed");
    expect(reelPhase({ status: "analysis_deleted" })).toBe("unavailable");
    expect(reelPhase({ status: "completed", is_draft: true })).toBe("draft");
    expect(reelPhase({ status: "completed", is_draft: false })).toBe("posted");
    expect(reelPhase({ status: "completed" })).toBe("posted");
  });

  it("keeps a held or hidden reel out of 'posted', and a draft stays a draft", () => {
    expect(reelPhase({ status: "completed", hidden_at: "2026-10-08T00:00:00Z" })).toBe("hidden");
    // Both flags set: it is still a draft until the member posts it.
    expect(reelPhase({ status: "completed", is_draft: true, hidden_at: "2026-10-08" })).toBe(
      "draft",
    );
  });
});

describe("normalizePostPackage", () => {
  it("cleans and caps what the pipeline stored", () => {
    const pkg = normalizePostPackage({
      captions: ["  One  ", "Two", "Three", "Four"],
      hashtags: ["#Hoops", "hoops", "dunk", " #  ", "a b"],
      overlays: [
        { at: "0:03", text: "Bucket" },
        { at: "x", text: "   " },
      ],
    })!;
    expect(pkg.captions).toEqual(["One", "Two", "Three"]);
    expect(pkg.hashtags).toEqual(["Hoops", "dunk", "ab"]);
    expect(pkg.overlays).toEqual([{ at: "0:03", text: "Bucket" }]);
  });

  it("accepts the legacy single caption and returns null for nothing usable", () => {
    expect(normalizePostPackage({ caption: "Solo" })?.captions).toEqual(["Solo"]);
    expect(normalizePostPackage(null)).toBeNull();
    expect(normalizePostPackage("nope")).toBeNull();
    expect(normalizePostPackage({ captions: [], hashtags: [], overlays: [] })).toBeNull();
  });
});

describe("captionChoices", () => {
  it("keeps the current caption as an option without duplicating it", () => {
    const pkg = { captions: ["Alpha", "Beta"], hashtags: [], overlays: [] };
    expect(captionChoices(pkg, "Gamma")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(captionChoices(pkg, "alpha")).toEqual(["Alpha", "Beta"]);
    expect(captionChoices(null, "Only")).toEqual(["Only"]);
    expect(captionChoices(null, null)).toEqual([]);
  });
});

describe("sanitizePostCopy", () => {
  it("returns only the fields that have something to save", () => {
    expect(sanitizePostCopy({})).toEqual({});
    expect(
      sanitizePostCopy({
        title: " Title ",
        caption: "x".repeat(600),
        hashtags: ["#a", "#A", "b"],
        overlays: [{ at: "0:01", text: "Hi" }],
      }),
    ).toEqual({
      ai_title: "Title",
      ai_caption: "x".repeat(500),
      ai_hashtags: ["a", "b"],
      ai_overlays: [{ at: "0:01", text: "Hi" }],
    });
  });

  it("caps hashtags at eight and ignores junk", () => {
    expect(cleanHashtags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(8);
    expect(cleanHashtags("nope")).toEqual([]);
    expect(sanitizePostCopy({ hashtags: [1, null, {}] })).toEqual({ ai_hashtags: ["1"] });
  });
});
