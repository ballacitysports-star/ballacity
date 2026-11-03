import { describe, expect, it } from "vitest";
import {
  approvalBlocksGame,
  approvalState,
  hostingErrorMessage,
  usableApprovals,
  type HostingApproval,
} from "./youth-hosting-approvals";

const NOW = Date.parse("2030-01-10T12:00:00Z");
const base: HostingApproval = {
  id: "a1",
  kind: "guardian",
  minor_id: "teen",
  approver_id: "guardian",
  org_id: null,
  status: "active",
  game_id: null,
  expires_at: "2030-01-12T12:00:00Z",
  created_at: "2030-01-10T10:00:00Z",
  used_at: null,
  revoked_at: null,
  payment_manager_id: null,
};

describe("approval state", () => {
  it("is ready only while active and unexpired", () => {
    expect(approvalState(base, NOW)).toBe("ready");
    expect(approvalState({ ...base, expires_at: "2030-01-10T11:59:00Z" }, NOW)).toBe("expired");
    expect(approvalState({ ...base, status: "used" }, NOW)).toBe("used");
    expect(approvalState({ ...base, status: "revoked" }, NOW)).toBe("revoked");
  });

  it("offers a teen only their own ready approvals, soonest expiry first", () => {
    const later = { ...base, id: "a2", expires_at: "2030-01-15T00:00:00Z" };
    const used = { ...base, id: "a3", status: "used" as const };
    const other = { ...base, id: "a4", minor_id: "someone-else" };
    expect(usableApprovals([later, used, other, base], "teen", NOW).map((a) => a.id)).toEqual([
      "a1",
      "a2",
    ]);
  });
});

describe("whether an approval can cover the game being created", () => {
  const ok = { approval: base, price: 0, minAge: 13, maxAge: 17, isPrivate: false, sessions: 1 };
  it("allows a free, public, youth-inclusive single game", () => {
    expect(approvalBlocksGame(ok)).toBeNull();
    expect(approvalBlocksGame({ ...ok, minAge: null, maxAge: null })).toBeNull(); // no limit = youth-inclusive
  });
  it("needs an approval at all", () => {
    expect(approvalBlocksGame({ ...ok, approval: null })).toMatch(/approve this game first/);
  });
  it("never lets an approval stand in for age eligibility (18+)", () => {
    expect(approvalBlocksGame({ ...ok, minAge: 18, maxAge: null })).toMatch(/18\+/);
    expect(approvalBlocksGame({ ...ok, minAge: 21, maxAge: 40 })).toMatch(/18\+/);
  });
  it("covers one game only", () => {
    expect(approvalBlocksGame({ ...ok, sessions: 3 })).toMatch(/one game/);
  });
  it("requires an adult payment manager for a paid game", () => {
    expect(approvalBlocksGame({ ...ok, price: 10 })).toMatch(/manage payment/);
    expect(
      approvalBlocksGame({
        ...ok,
        price: 10,
        approval: { ...base, payment_manager_id: "guardian" },
      }),
    ).toBeNull();
  });
  it("needs a public game for a club approval", () => {
    const org = { ...base, kind: "organization" as const, org_id: "org" };
    expect(approvalBlocksGame({ ...ok, approval: org, isPrivate: true })).toMatch(/public/);
    expect(approvalBlocksGame({ ...ok, approval: org })).toBeNull();
  });
});

describe("refusal wording", () => {
  it("translates the database codes", () => {
    expect(hostingErrorMessage(new Error("ADULT_HOST_REQUIRED: x"))).toMatch(/18 and over/);
    expect(hostingErrorMessage(new Error("MINOR_HOST_APPROVAL_INVALID: x"))).toMatch(/expired/);
    expect(hostingErrorMessage(new Error("MINOR_CANNOT_COLLECT_PAYMENTS"))).toMatch(/adult/);
    expect(hostingErrorMessage(new Error("something else"))).toBeNull();
  });
});
