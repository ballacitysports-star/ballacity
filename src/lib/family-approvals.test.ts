import { describe, expect, it } from "vitest";
import { buildFamilyApprovals, type GuardianJoinRequest } from "@/lib/family-approvals";
import type { GuardianChild, ParentRequestRow } from "@/lib/child-safety.functions";
import type { MinorInvite } from "@/lib/family-invites.functions";
import type { GuardianPendingTeamInvite } from "@/lib/team-roster";
import type { GuardianUnsignedWaiver } from "@/lib/team-waivers";

const child = (over: Partial<GuardianChild> = {}): GuardianChild =>
  ({
    childUserId: "c1",
    displayName: "Sam",
    username: "sam",
    cohort: "child_under_13",
    consent: null,
    controls: {} as GuardianChild["controls"],
    ...over,
  }) as GuardianChild;

const invite = (over: Partial<MinorInvite> = {}): MinorInvite => ({
  id: "i1",
  childName: "Sam",
  relationship: "parent",
  status: "pending",
  expiresAt: "2026-10-01T00:00:00Z",
  redeemedAt: null,
  childUserId: null,
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

const request = (over: Partial<ParentRequestRow> = {}): ParentRequestRow => ({
  id: "r1",
  child_user_id: "c1",
  kind: "access",
  status: "open",
  details: null,
  created_at: "2026-09-02T00:00:00Z",
  resolution_notes: null,
  ...over,
});

describe("buildFamilyApprovals", () => {
  it("returns nothing when there is nothing outstanding", () => {
    expect(
      buildFamilyApprovals({
        children: [child({ consent: { status: "approved" } as GuardianChild["consent"] })],
        invites: [invite({ status: "redeemed" })],
        requests: [request({ status: "completed" })],
      }),
    ).toEqual([]);
  });

  it("raises consent approvals that still need the guardian", () => {
    const items = buildFamilyApprovals({
      children: [child({ consent: { status: "pending" } as GuardianChild["consent"] })],
      invites: [],
      requests: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("consent");
    expect(items[0]!.urgency).toBe("action_needed");
    expect(items[0]!.actionTo).toBe("/parent");
  });

  it("lists pending invitations and open requests as waiting, after action items", () => {
    const items = buildFamilyApprovals({
      children: [child({ consent: { status: "required" } as GuardianChild["consent"] })],
      invites: [invite()],
      requests: [request()],
    });
    expect(items.map((i) => i.source)).toEqual(["consent", "request", "invite"]);
    expect(items.slice(1).every((i) => i.urgency === "waiting")).toBe(true);
    expect(items.slice(1).every((i) => i.actionLabel === null)).toBe(true);
  });

  it("flags a withdrawn consent so the guardian can restore access", () => {
    const items = buildFamilyApprovals({
      children: [child({ consent: { status: "revoked" } as GuardianChild["consent"] })],
      invites: [],
      requests: [],
    });
    expect(items[0]!.urgency).toBe("action_needed");
    expect(items[0]!.title).toContain("paused");
  });
});

const teamInvite = (over: Partial<GuardianPendingTeamInvite> = {}): GuardianPendingTeamInvite =>
  ({
    id: "ti1",
    teamId: "team1",
    inviteeId: "c1",
    invitedBy: "owner1",
    role: "player",
    message: null,
    status: "pending",
    expiresAt: "2026-10-15T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    teamName: "The Hawks",
    childDisplayName: "Sam",
    guardianApproved: false,
    ...over,
  }) as GuardianPendingTeamInvite;

const joinRequest = (over: Partial<GuardianJoinRequest> = {}): GuardianJoinRequest =>
  ({
    id: "jr1",
    game_id: "game1",
    player_id: "c1",
    host_id: "host1",
    status: "pending",
    message: null,
    reviewer_notes: null,
    created_at: "2026-09-01T00:00:00Z",
    reviewed_at: null,
    guardian_approved_at: null,
    gameTitle: "Sunday Pickup",
    childDisplayName: "Sam",
    ...over,
  }) as GuardianJoinRequest;

const unsignedWaiver = (over: Partial<GuardianUnsignedWaiver> = {}): GuardianUnsignedWaiver => ({
  childUserId: "c1",
  teamId: "team1",
  teamName: "The Hawks",
  waiverId: "w1",
  childDisplayName: "Sam",
  ...over,
});

describe("buildFamilyApprovals: team/game approvals and waivers", () => {
  it("raises a pending team invite the guardian hasn't approved yet", () => {
    const items = buildFamilyApprovals({
      children: [],
      invites: [],
      requests: [],
      teamInvites: [teamInvite()],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("team_join");
    expect(items[0]!.urgency).toBe("action_needed");
    expect(items[0]!.approveAction).toEqual({ kind: "team_invite", id: "ti1", teamId: "team1" });
  });

  it("drops a team invite once the guardian has already approved it", () => {
    const items = buildFamilyApprovals({
      children: [],
      invites: [],
      requests: [],
      teamInvites: [teamInvite({ guardianApproved: true })],
    });
    expect(items).toEqual([]);
  });

  it("raises a pending game join request the guardian hasn't approved yet", () => {
    const items = buildFamilyApprovals({
      children: [],
      invites: [],
      requests: [],
      joinRequests: [joinRequest()],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("game_join");
    expect(items[0]!.approveAction).toEqual({ kind: "join_request", id: "jr1" });
  });

  it("drops a join request once the guardian has already approved it", () => {
    const items = buildFamilyApprovals({
      children: [],
      invites: [],
      requests: [],
      joinRequests: [joinRequest({ guardian_approved_at: "2026-09-02T00:00:00Z" })],
    });
    expect(items).toEqual([]);
  });

  it("raises every unsigned waiver as its own action-needed item", () => {
    const items = buildFamilyApprovals({
      children: [],
      invites: [],
      requests: [],
      unsignedWaivers: [unsignedWaiver()],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("waiver");
    expect(items[0]!.urgency).toBe("action_needed");
    expect(items[0]!.approveAction).toEqual({ kind: "waiver", id: "w1", teamId: "team1" });
  });
});
