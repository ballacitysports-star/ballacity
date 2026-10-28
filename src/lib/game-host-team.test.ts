import { describe, expect, it } from "vitest";
import { gameHostSource, hostTeamLink, toGameHostOrg, toGameHostTeam } from "./game-host-team";

describe("toGameHostTeam", () => {
  it("uses the team's name and logo", () => {
    expect(
      toGameHostTeam({
        id: "t1",
        name: "BallaCity",
        kind: "team",
        avatar: "BC",
        avatar_url: "https://x/logo.png",
        verified: true,
      }),
    ).toEqual({
      id: "t1",
      name: "BallaCity",
      kind: "team",
      avatarUrl: "https://x/logo.png",
      initials: "BA",
      verified: true,
    });
  });

  it("reads an older row whose logo URL sits in avatar, and ignores initials stored there", () => {
    expect(
      toGameHostTeam({
        id: "t",
        name: "Hoopers",
        kind: null,
        avatar: "/storage/x.jpg",
        avatar_url: null,
        verified: null,
      }).avatarUrl,
    ).toBe("/storage/x.jpg");
    expect(
      toGameHostTeam({
        id: "t",
        name: "Hoopers",
        kind: null,
        avatar: "HP",
        avatar_url: null,
        verified: null,
      }).avatarUrl,
    ).toBeNull();
  });

  it("copes with a team with no name", () => {
    expect(
      toGameHostTeam({
        id: "t",
        name: " ",
        kind: "team",
        avatar: null,
        avatar_url: null,
        verified: false,
      }).name,
    ).toBe("Team");
  });
});

describe("hostTeamLink", () => {
  it("sends a team to its page and a trainer profile to the trainer page", () => {
    expect(hostTeamLink({ id: "t1", kind: "team" })).toEqual({
      to: "/teams/$teamId",
      params: { teamId: "t1" },
    });
    expect(hostTeamLink({ id: "c1", kind: "coach" })).toEqual({
      to: "/trainers/$trainerId",
      params: { trainerId: "c1" },
    });
  });
});

describe("gym hosts", () => {
  it("links a gym to its page", () => {
    expect(hostTeamLink({ id: "o1", kind: "gym" })).toEqual({
      to: "/orgs/$orgId",
      params: { orgId: "o1" },
    });
  });

  it("reads a gym row like a team's", () => {
    expect(
      toGameHostOrg({
        id: "o1",
        name: "Apex Hub",
        avatar: null,
        avatar_url: "https://x/a.png",
        verified: true,
      }),
    ).toEqual({
      id: "o1",
      name: "Apex Hub",
      kind: "gym",
      avatarUrl: "https://x/a.png",
      initials: "AP",
      verified: true,
    });
  });
});

describe("gameHostSource", () => {
  it("is the team for a team game, even at a gym", () => {
    expect(gameHostSource({ teamId: "t1", orgId: "o1", orgOfficial: true })).toEqual({
      kind: "team",
      id: "t1",
    });
  });
  it("is the gym only for an official gym event", () => {
    expect(gameHostSource({ orgId: "o1", orgOfficial: true })).toEqual({ kind: "gym", id: "o1" });
    expect(gameHostSource({ orgId: "o1", orgOfficial: false })).toBeNull();
  });
  it("is nobody for a personal game", () => {
    expect(gameHostSource({})).toBeNull();
  });
});
