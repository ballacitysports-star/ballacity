import { describe, expect, it } from "vitest";
import { buildFamilyApprovals } from "@/lib/family-approvals";
import type { GuardianChild, ParentRequestRow } from "@/lib/child-safety.functions";
import type { MinorInvite } from "@/lib/family-invites.functions";

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
