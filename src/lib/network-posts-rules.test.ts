import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  audiencesForCohort,
  audiencesForEntity,
  parseNetworkPostsFlag,
  postErrorMessage,
} from "./network-posts-rules";

describe("audiencesForCohort", () => {
  it("lets an adult use every audience", () => {
    expect(audiencesForCohort("adult")).toEqual(["public", "followers", "team", "family"]);
  });

  it("never offers a minor a public audience", () => {
    expect(audiencesForCohort("teen_16_17")).toEqual(["followers", "team", "family"]);
    expect(audiencesForCohort("teen_13_15")).toEqual(["team", "family"]);
  });

  it("offers nothing under 13 or without a date of birth", () => {
    expect(audiencesForCohort("child_under_13")).toEqual([]);
    expect(audiencesForCohort("unknown")).toEqual([]);
  });

  it("matches the database's caps exactly", () => {
    const sql = readFileSync("supabase/migrations/20261106210000_network_posts.sql", "utf8");
    const caps = sql.slice(sql.indexOf("post_audiences_allowed(_author uuid)"));
    expect(caps).toContain("WHEN 'adult' THEN ARRAY['public', 'followers', 'team', 'family']");
    expect(caps).toContain("WHEN 'teen_16_17' THEN ARRAY['followers', 'team', 'family']");
    expect(caps).toContain("WHEN 'teen_13_15' THEN ARRAY['team', 'family']");
    expect(caps).toContain("ELSE ARRAY[]::text[]");
  });
});

describe("audiencesForEntity", () => {
  it("lets a team post publicly or to its members, and a facility publicly", () => {
    expect(audiencesForEntity("team")).toEqual(["public", "team"]);
    expect(audiencesForEntity("org")).toEqual(["public"]);
  });
});

describe("postErrorMessage", () => {
  it("explains each refusal", () => {
    expect(postErrorMessage("POST_LOCKED")).toMatch(/parent or guardian/);
    expect(postErrorMessage("POST_AGE_NOT_ALLOWED")).toMatch(/isn't available/);
    expect(postErrorMessage("POST_AUDIENCE_NOT_ALLOWED")).toMatch(/audience/);
    expect(postErrorMessage("POST_TARGET_INVALID")).toMatch(/team or facility/);
    expect(postErrorMessage("network down")).toBe("network down");
  });
});

describe("parseNetworkPostsFlag", () => {
  it("is on only for an explicit enabled: true", () => {
    expect(parseNetworkPostsFlag({ enabled: true })).toBe(true);
    expect(parseNetworkPostsFlag({ enabled: false })).toBe(false);
    expect(parseNetworkPostsFlag({ enabled: "true" })).toBe(false);
    expect(parseNetworkPostsFlag(null)).toBe(false);
  });
});
