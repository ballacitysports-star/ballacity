import { describe, expect, it } from "vitest";
import { hostTeamLink, toGameHostTeam } from "./game-host-team";

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
