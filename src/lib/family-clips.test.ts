import { describe, expect, it } from "vitest";
import { familyClipVia, familyClipViaLabel, teamShareErrorMessage } from "@/lib/family-clips";

describe("family clip tiers", () => {
  it("accepts only the three ways a clip can be seen", () => {
    expect(familyClipVia("child")).toBe("child");
    expect(familyClipVia("team")).toBe("team");
    expect(familyClipVia("owner")).toBe("owner");
    for (const bad of ["none", "public", "", null, undefined, 3]) {
      expect(familyClipVia(bad)).toBeNull();
    }
  });

  it("explains why a viewer can see a clip without naming anyone", () => {
    expect(familyClipViaLabel("child")).toBe("A clip your parent added of you");
    expect(familyClipViaLabel("team")).toBe("Shared with your team");
    expect(familyClipViaLabel("owner")).toBe("A clip you added");
  });

  it("words every team-sharing error code", () => {
    for (const code of [
      "FAMILY_TEAM_SHARE_OFF",
      "FAMILY_TEAM_NOT_FAMILY_POST",
      "FAMILY_POST_NOT_GUARDIAN",
      "FAMILY_TEAM_CHILD_NOT_ON_TEAM",
    ]) {
      const msg = teamShareErrorMessage({ message: `P0001 ${code}` });
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("FAMILY_");
    }
    expect(teamShareErrorMessage(new Error("network down"))).toBeNull();
    expect(teamShareErrorMessage(null)).toBeNull();
  });
});
