import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  achievementAudiences,
  achievementPostBody,
  audiencesForCohort,
} from "@/lib/network-posts-rules";
import { BADGES } from "@/lib/badges";
import { AGE_COHORTS } from "@/lib/child-policy";

describe("achievement posts (P3-8)", () => {
  it("writes the badge into the post", () => {
    expect(
      achievementPostBody({ emoji: "✅", label: "Showed Up", description: "Attend 5 games." }),
    ).toBe("✅ Earned the Showed Up badge on BallaCity. Attend 5 games.");
  });

  it("fits every badge within the post length limit", () => {
    for (const b of BADGES) expect(achievementPostBody(b).length).toBeLessThanOrEqual(2000);
  });

  it("never offers an audience the age may not post to, and leaves out My team", () => {
    for (const c of AGE_COHORTS) {
      const allowed = audiencesForCohort(c);
      const offered = achievementAudiences(c);
      expect(offered.every((a) => allowed.includes(a))).toBe(true);
      expect(offered).not.toContain("team");
    }
    expect(achievementAudiences("adult")).toEqual(["public", "followers", "family"]);
    expect(achievementAudiences("teen_13_15")).toEqual(["family"]);
    expect(achievementAudiences("child_under_13")).toEqual([]);
  });

  it("is opt-in: the share sends kind 'achievement' only from the dialog's Share button", () => {
    const src = readFileSync("src/components/posts/ShareBadge.tsx", "utf8");
    expect(src).toMatch(/kind: "achievement"/);
    expect(src).toMatch(/onClick=\{\(\) => share\.mutate\(\)\}/);
    expect(src).not.toMatch(/useEffect/);
  });

  it("the profile offers Share only for badges the engine earned from real activity", () => {
    const src = readFileSync("src/routes/_tabs.profile.tsx", "utf8");
    expect(src).toMatch(/const shareableBadges = new Set\(earnedBadgeIds\(badgeStats\)\)/);
    expect(src).toMatch(/shareableBadges\.has\(id\) \? <ShareBadge badgeId=\{id\} \/> : null/);
  });
});
