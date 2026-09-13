import { describe, expect, it } from "vitest";
import { teamPermissions, teamRosterErrorMessage, ASSIGNABLE_ROLES } from "@/lib/team-roster";
import { reliabilityPercent, toBadgeStats, EMPTY_PLAYER_STATS } from "@/lib/player-stats";

describe("teamPermissions", () => {
  it("gives owners full control but no leave path", () => {
    const p = teamPermissions("owner");
    expect(p).toMatchObject({
      canInvite: true,
      canRemoveMembers: true,
      canAssignRoles: true,
      canLeave: false,
    });
  });

  it("lets coaches manage the roster but not roles", () => {
    const p = teamPermissions("coach");
    expect(p.canInvite).toBe(true);
    expect(p.canRemoveMembers).toBe(true);
    expect(p.canAssignRoles).toBe(false);
  });

  it("gives captains and players no management rights", () => {
    for (const role of ["captain", "player"] as const) {
      const p = teamPermissions(role);
      expect(p.isMember).toBe(true);
      expect(p.canInvite).toBe(false);
      expect(p.canRemoveMembers).toBe(false);
      expect(p.canLeave).toBe(true);
    }
  });

  it("treats non-members as read-only", () => {
    expect(teamPermissions(null)).toMatchObject({
      isMember: false,
      canInvite: false,
      canLeave: false,
    });
  });

  it("never offers owner as an assignable role", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
  });
});

describe("teamRosterErrorMessage", () => {
  it("translates server codes into plain sentences", () => {
    expect(teamRosterErrorMessage(new Error("NOT_TEAM_MANAGER"))).toMatch(
      /owner, managers or coaches/,
    );
    expect(teamRosterErrorMessage(new Error("INVITE_EXPIRED"))).toMatch(/expired/);
    expect(teamRosterErrorMessage(new Error("ALREADY_MEMBER"))).toMatch(/already on the roster/);
    expect(teamRosterErrorMessage(new Error("boom"))).toMatch(/Couldn't update the roster/);
  });
});

describe("reliability from real activity", () => {
  it("starts new players clean instead of at zero", () => {
    expect(reliabilityPercent(EMPTY_PLAYER_STATS)).toBe(100);
  });

  it("ignores unmarked games", () => {
    const s = { ...EMPTY_PLAYER_STATS, gamesJoined: 10, gamesAttended: 3, noShows: 1 };
    expect(reliabilityPercent(s)).toBe(75);
  });

  it("feeds attendance, not skill, into badge stats", () => {
    const s = {
      ...EMPTY_PLAYER_STATS,
      gamesAttended: 8,
      noShows: 2,
      hostedCompleted: 3,
      reviewAvg: 4.5,
      reviewCount: 6,
    };
    const b = toBadgeStats(s);
    expect(b.gamesPlayed).toBe(8);
    expect(b.hosted).toBe(3);
    expect(b.showUpRate).toBeCloseTo(0.8);
    expect(b.sportsmanshipRating).toBe(4.5);
  });
});
