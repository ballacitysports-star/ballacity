import { describe, expect, it } from "vitest";
import { familyPostErrorMessage } from "@/lib/family-posts";

describe("familyPostErrorMessage", () => {
  it("explains every database error code in plain words", () => {
    for (const code of [
      "FAMILY_POSTS_OFF",
      "FAMILY_POST_NOT_GUARDIAN",
      "FAMILY_POST_UNDER_13_ONLY",
      "FAMILY_POST_UNDER_16_ONLY",
      "FAMILY_POST_AI_OFF",
    ]) {
      const msg = familyPostErrorMessage({ message: `${code}` });
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("FAMILY_");
    }
  });

  it("finds the code inside a longer message and accepts a plain string", () => {
    expect(familyPostErrorMessage(new Error("P0001: FAMILY_POST_AI_OFF"))).toContain("AI video");
    expect(familyPostErrorMessage("FAMILY_POSTS_OFF")).toContain("aren't available");
  });

  it("ignores unrelated errors", () => {
    expect(familyPostErrorMessage(new Error("network down"))).toBeNull();
    expect(familyPostErrorMessage(null)).toBeNull();
    expect(familyPostErrorMessage(undefined)).toBeNull();
  });
});
