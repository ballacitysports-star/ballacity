import { describe, expect, it } from "vitest";
import { gameCardCueLabel, joinBusyLabel } from "./game-cta-copy";

describe("gameCardCueLabel names where the card leads, never a state", () => {
  it("offers to join only when joining is open and the viewer has no part in the game", () => {
    expect(gameCardCueLabel({ inFlow: false, locked: false, parentMode: false })).toBe(
      "View & join",
    );
  });

  it("does not promise joining when it is closed, full or ended", () => {
    expect(gameCardCueLabel({ inFlow: false, locked: true, parentMode: false })).toBe(
      "View details",
    );
  });

  it("does not promise joining in parent mode, which hides it", () => {
    expect(gameCardCueLabel({ inFlow: false, locked: false, parentMode: true })).toBe(
      "View details",
    );
  });

  it("points people who already have a request, payment or spot at their own entry", () => {
    for (const locked of [false, true]) {
      for (const parentMode of [false, true]) {
        expect(gameCardCueLabel({ inFlow: true, locked, parentMode })).toBe("View your spot");
      }
    }
  });

  it("never claims a spot is confirmed", () => {
    for (const inFlow of [true, false]) {
      for (const locked of [true, false]) {
        for (const parentMode of [true, false]) {
          expect(gameCardCueLabel({ inFlow, locked, parentMode })).not.toMatch(
            /confirm|you'?re in|joined/i,
          );
        }
      }
    }
  });
});

describe("joinBusyLabel", () => {
  const base = {
    isConfirmed: false,
    joined: false,
    isPaid: false,
    isPending: false,
    requiresApproval: false,
    isApproved: false,
    payingPending: false,
  };

  it("says Leaving for someone on the roster", () => {
    expect(joinBusyLabel({ ...base, isConfirmed: true })).toBe("Leaving…");
    expect(joinBusyLabel({ ...base, joined: true })).toBe("Leaving…");
  });

  it("distinguishes cancelling a request from withdrawing a payment", () => {
    expect(joinBusyLabel({ ...base, isPending: true })).toBe("Cancelling request…");
    expect(joinBusyLabel({ ...base, isPending: true, payingPending: true })).toBe("Withdrawing…");
  });

  it("says Sending request where the host must approve, Joining otherwise", () => {
    expect(joinBusyLabel({ ...base, requiresApproval: true })).toBe("Sending request…");
    expect(joinBusyLabel({ ...base, requiresApproval: true, isApproved: true })).toBe("Joining…");
    expect(joinBusyLabel(base)).toBe("Joining…");
  });

  it("never reports success while busy", () => {
    for (const label of [
      joinBusyLabel(base),
      joinBusyLabel({ ...base, isConfirmed: true }),
      joinBusyLabel({ ...base, isPending: true }),
    ]) {
      expect(label).not.toMatch(/confirm|you'?re in|joined|done|success/i);
    }
  });
});
