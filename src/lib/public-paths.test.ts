import { describe, expect, it } from "vitest";
import {
  isPublicFacilityPath,
  isPublicGamePath,
  isPublicTeamPath,
  isPublicTrainerPath,
  isSignedOutPreviewPath,
  showsSignedOutBar,
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

describe("isPublicTrainerPath", () => {
  it("opens a single trainer's page", () => {
    expect(isPublicTrainerPath("/trainers/abc123")).toBe(true);
    expect(isPublicTrainerPath("/trainers/abc123/")).toBe(true);
    expect(isPublicTrainerPath("/trainers/created-coach")).toBe(true);
  });

  it("keeps booking, editing and the create flow behind sign-in", () => {
    for (const p of ["edit", "book", "availability", "sessions"]) {
      expect(isPublicTrainerPath(`/trainers/abc123/${p}`)).toBe(false);
    }
    expect(isPublicTrainerPath("/trainers/create")).toBe(false);
    expect(isPublicTrainerPath("/trainers")).toBe(false);
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
  it("combines the four, and nothing else", () => {
    expect(isSignedOutPublicPath("/games/x")).toBe(true);
    expect(isSignedOutPublicPath("/teams/x")).toBe(true);
    expect(isSignedOutPublicPath("/orgs/x")).toBe(true);
    expect(isSignedOutPublicPath("/feed")).toBe(true);
    expect(isSignedOutPublicPath("/trainers/x")).toBe(true);
    // Beneath a tab, and the private pages, stay behind sign-in.
    for (const p of [
      "/players/x",
      "/trainers/x/edit",
      "/profile/edit",
      "/messages/x",
      "/settings",
    ]) {
      expect(isSignedOutPublicPath(p)).toBe(false);
    }
  });
});

describe("isSignedOutPreviewPath", () => {
  it("previews each tab, with or without a trailing slash", () => {
    for (const p of [
      "/feed",
      "/players",
      "/teams",
      "/trainers",
      "/reels",
      "/messages",
      "/create",
      "/profile",
    ]) {
      expect(isSignedOutPreviewPath(p)).toBe(true);
      expect(isSignedOutPreviewPath(`${p}/`)).toBe(true);
      expect(isSignedOutPublicPath(p)).toBe(true);
    }
  });

  it("keeps everything beneath a tab, and the private tabs, behind sign-in", () => {
    for (const p of [
      "/teams/create",
      "/profile/edit",
      "/players/add",
      "/reels/abc",
      "/notifications",
      "/messages/abc",
      "/settings",
      "/admin",
      "/parent",
      "/guardian",
    ]) {
      expect(isSignedOutPreviewPath(p)).toBe(false);
    }
    expect(isSignedOutPublicPath("/notifications")).toBe(false);
    expect(isSignedOutPublicPath("/messages/abc")).toBe(false);
  });
});

describe("showsSignedOutBar", () => {
  it("draws the bottom bar on the tab previews and on the public Reels and Gyms pages", () => {
    for (const p of [
      "/feed",
      "/players",
      "/messages",
      "/profile",
      "/highlights",
      "/highlights/",
      "/orgs",
    ]) {
      expect(showsSignedOutBar(p)).toBe(true);
    }
  });

  it("does not draw it on detail pages, sign-in or the marketing page", () => {
    for (const p of ["/", "/auth", "/games/x", "/teams/x", "/orgs/x", "/highlights/x", "/terms"]) {
      expect(showsSignedOutBar(p)).toBe(false);
    }
  });
});
