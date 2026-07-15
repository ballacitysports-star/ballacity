import { describe, it, expect } from "vitest";
import { shouldTriggerLeaveBranch } from "./leave-branch";

describe("shouldTriggerLeaveBranch", () => {
  it("returns true when the viewer is fully confirmed", () => {
    expect(
      shouldTriggerLeaveBranch({
        isConfirmed: true,
        joined: true,
        requiresApproval: true,
        isPaid: true,
      }),
    ).toBe(true);
  });

  it("returns true on a free, no-approval game when joined locally", () => {
    expect(
      shouldTriggerLeaveBranch({
        isConfirmed: false,
        joined: true,
        requiresApproval: false,
        isPaid: false,
      }),
    ).toBe(true);
  });

  // Regression guard: after leaving an approval-required game, a stale
  // `joined=true` (from a race with realtime auto-join) must not re-route
  // a "Request to join" tap into the leave branch.
  it("returns false when joined is stale on an approval-required game", () => {
    expect(
      shouldTriggerLeaveBranch({
        isConfirmed: false,
        joined: true,
        requiresApproval: true,
        isPaid: false,
      }),
    ).toBe(false);
  });

  it("returns false when joined is stale on a paid game", () => {
    expect(
      shouldTriggerLeaveBranch({
        isConfirmed: false,
        joined: true,
        requiresApproval: false,
        isPaid: true,
      }),
    ).toBe(false);
  });

  it("returns false when nothing is set", () => {
    expect(
      shouldTriggerLeaveBranch({
        isConfirmed: false,
        joined: false,
        requiresApproval: false,
        isPaid: false,
      }),
    ).toBe(false);
  });

  it("returns false when only approval is required and viewer is not joined", () => {
    expect(
      shouldTriggerLeaveBranch({
        isConfirmed: false,
        joined: false,
        requiresApproval: true,
        isPaid: true,
      }),
    ).toBe(false);
  });
});
