import { describe, expect, it } from "vitest";
import {
  isPublicFacilityPath,
  isPublicGamePath,
  isPublicTeamPath,
  isSignedOutPublicPath,
} from "./public-paths";

describe("isPublicGamePath", () => {
  it("opens a single game's page", () => {
    expect(isPublicGamePath("/games/abc123")).toBe(true);
    expect(isPublicGamePath("/games/abc123/")).toBe(true);
    expect(isPublicGamePath("/games/6f1c2d3e-0000-4000-8000-123456789abc")).toBe(true);
  });

  it("keeps a game's sub-pages behind sign-in", () => {
    expect(isPublicGamePath("/games/abc123/pay")).toBe(false);
    expect(isPublicGamePath("/games/abc123/payment-setup")).toBe(false);
  });

  it("does not open the games root or other areas", () => {
    expect(isPublicGamePath("/games")).toBe(false);
    expect(isPublicGamePath("/games/")).toBe(false);
    expect(isPublicGamePath("/feed")).toBe(false);
    expect(isPublicGamePath("/mygames/abc123")).toBe(false);
  });
});

describe("isPublicTeamPath", () => {
  it("opens a single team's page", () => {
    expect(isPublicTeamPath("/teams/abc123")).toBe(true);
    expect(isPublicTeamPath("/teams/abc123/")).toBe(true);
  });

  it("keeps every team sub-page and the create flow behind sign-in", () => {
    for (const p of [
      "manage",
      "edit",
      "roster",
      "events",
      "invites",
      "waiver",
      "season",
      "tryouts",
    ]) {
      expect(isPublicTeamPath(`/teams/abc123/${p}`)).toBe(false);
    }
    expect(isPublicTeamPath("/teams/create")).toBe(false);
    expect(isPublicTeamPath("/teams/create/")).toBe(false);
  });

  it("does not open the teams tab", () => {
    expect(isPublicTeamPath("/teams")).toBe(false);
    expect(isPublicTeamPath("/teams/")).toBe(false);
  });

  it("still opens a team whose id merely starts with 'create'", () => {
    expect(isPublicTeamPath("/teams/created-fc")).toBe(true);
  });
});

describe("isPublicFacilityPath", () => {
  it("opens the directory and a single facility", () => {
    expect(isPublicFacilityPath("/orgs")).toBe(true);
    expect(isPublicFacilityPath("/orgs/")).toBe(true);
    expect(isPublicFacilityPath("/orgs/6f1c2d3e-0000-4000-8000-123456789abc")).toBe(true);
  });

  it("keeps create, edit and members behind sign-in", () => {
    expect(isPublicFacilityPath("/orgs/create")).toBe(false);
    expect(isPublicFacilityPath("/orgs/abc/edit")).toBe(false);
    expect(isPublicFacilityPath("/orgs/abc/members")).toBe(false);
  });
});

describe("isSignedOutPublicPath", () => {
  it("combines the three, and nothing else", () => {
    expect(isSignedOutPublicPath("/games/x")).toBe(true);
    expect(isSignedOutPublicPath("/teams/x")).toBe(true);
    expect(isSignedOutPublicPath("/orgs/x")).toBe(true);
    for (const p of ["/feed", "/players/x", "/trainers/x", "/profile", "/messages", "/settings"]) {
      expect(isSignedOutPublicPath(p)).toBe(false);
    }
  });
});
