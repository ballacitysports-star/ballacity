import { describe, expect, it } from "vitest";
import { HERO_IMAGE, imageFor, resolveSportAsset, toStoredCover } from "@/lib/sample-data";

describe("toStoredCover", () => {
  it("saves a built-in sport image by name", () => {
    expect(toStoredCover(imageFor("Basketball"))).toBe("preset:basketball");
    expect(toStoredCover(imageFor("Soccer"))).toBe("preset:soccer");
  });

  it("saves older hashed bundle URLs by name too", () => {
    expect(toStoredCover("/assets/sport-tennis-B3x_k9.jpg")).toBe("preset:tennis");
    expect(toStoredCover("https://app.example/assets/sport-running-abc123.jpg?v=2")).toBe(
      "preset:running",
    );
  });

  it("keeps uploaded images, other URLs, empty values and existing names as they are", () => {
    const upload = "https://x.supabase.co/storage/v1/object/public/team-covers/u/1.jpg";
    expect(toStoredCover(upload)).toBe(upload);
    expect(toStoredCover("/assets/hero-court-1.jpg")).toBe("/assets/hero-court-1.jpg");
    expect(toStoredCover("")).toBe("");
    expect(toStoredCover(null)).toBeNull();
    expect(toStoredCover("preset:soccer")).toBe("preset:soccer");
  });
});

describe("resolveSportAsset", () => {
  it("turns a saved name back into the current image", () => {
    expect(resolveSportAsset("preset:baseball")).toBe(imageFor("Baseball"));
    expect(resolveSportAsset("preset:Pickleball")).toBe(imageFor("Pickleball"));
  });

  it("falls back to the default image for a name it doesn't know", () => {
    expect(resolveSportAsset("preset:curling")).toBe(HERO_IMAGE);
  });

  it("still maps older hashed bundle URLs and leaves other values alone", () => {
    expect(resolveSportAsset("/assets/sport-volleyball-old1234.jpg")).toBe(imageFor("Volleyball"));
    const upload = "https://x.supabase.co/storage/v1/object/public/team-covers/u/1.jpg";
    expect(resolveSportAsset(upload)).toBe(upload);
    expect(resolveSportAsset("")).toBe("");
    expect(resolveSportAsset(undefined)).toBeUndefined();
  });

  it("round-trips every built-in sport", () => {
    for (const sport of [
      "Basketball",
      "Soccer",
      "Pickleball",
      "Volleyball",
      "Tennis",
      "Football",
      "Baseball",
      "Softball",
      "Running",
    ] as const) {
      expect(resolveSportAsset(toStoredCover(imageFor(sport)))).toBe(imageFor(sport));
    }
  });
});
