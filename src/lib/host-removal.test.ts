import { describe, expect, it } from "vitest";
import {
  REMOVED_ASK_LABEL,
  REMOVED_BY_HOST_MESSAGE,
  removedAskNotice,
  removedBannerCopy,
  removedFlowStatus,
  viewerJoinFlags,
  viewerRemoved,
  viewerRequiresApproval,
} from "@/lib/host-removal";
import { joinPreflightRefusal } from "@/lib/join-preflight";
import { joinGateErrorMessage } from "@/lib/game-status";
import { USER_ERROR_MESSAGES } from "@/lib/user-error";

/**
 * A player the host removed (20261202100000, owner decisions 2026-11-24 "Removal sticks on open games" and "Ask the
 * host, or an invite"): the game page shows the removal before "Confirmed", keeps a pending payment's withdraw, and
 * sends the player's tap to the host as a request on any game.
 */
const base = {
  requiresApproval: false,
  removed: false,
  isPaid: false,
  requestStatus: null as string | null,
  guardianOnly: false,
  latestPaymentStatus: null as string | null,
  waitingOnParent: false,
};

describe("viewerRequiresApproval: the page's request-to-join rule", () => {
  const input = {
    hostRequiresApproval: false,
    isHost: false,
    ageNeedsApproval: false,
    removed: false,
  };
  it("is the host's setting or an age range, as before", () => {
    expect(viewerRequiresApproval(input)).toBe(false);
    expect(viewerRequiresApproval({ ...input, hostRequiresApproval: true })).toBe(true);
    expect(viewerRequiresApproval({ ...input, ageNeedsApproval: true })).toBe(true);
    expect(viewerRequiresApproval({ ...input, ageNeedsApproval: true, isHost: true })).toBe(false);
  });
  it("sends a removed player through the host on an open game", () => {
    expect(viewerRequiresApproval({ ...input, removed: true })).toBe(true);
  });
});

describe("viewerRemoved", () => {
  const v = { recorded: true, isHost: false, joined: false, requestStatus: null };
  it("is the record, for a viewer who is not the host and not on the roster", () => {
    expect(viewerRemoved(v)).toBe(true);
    expect(viewerRemoved({ ...v, recorded: false })).toBe(false);
    expect(viewerRemoved({ ...v, isHost: true })).toBe(false);
    expect(viewerRemoved({ ...v, joined: true })).toBe(false);
  });

  it("ends with an approved request (the approval deletes the record), whatever the page last read", () => {
    expect(viewerRemoved({ ...v, requestStatus: "approved" })).toBe(false);
    expect(viewerRemoved({ ...v, requestStatus: "pending" })).toBe(true);
    expect(viewerRemoved({ ...v, requestStatus: "rejected" })).toBe(true);
  });
});

describe("viewerJoinFlags: the main button's order for a removed player (M3)", () => {
  it("is unchanged for a player who was not removed", () => {
    // Open free game: nothing to confirm, the tap joins.
    expect(viewerJoinFlags(base)).toMatchObject({
      hostDecides: false,
      approvalCleared: true,
      isConfirmed: false,
      isPending: false,
    });
    // Paid open game with a verified payment: confirmed.
    expect(
      viewerJoinFlags({ ...base, isPaid: true, latestPaymentStatus: "verified" }),
    ).toMatchObject({ isConfirmed: true, isPending: false });
    // Approval game, approved: confirmed; a guardian still to approve: not.
    expect(
      viewerJoinFlags({ ...base, requiresApproval: true, requestStatus: "approved" }),
    ).toMatchObject({ isConfirmed: true });
    expect(
      viewerJoinFlags({
        ...base,
        requiresApproval: true,
        requestStatus: "approved",
        waitingOnParent: true,
      }),
    ).toMatchObject({ isConfirmed: false });
    // A payment waiting on the host only shows once approval is cleared.
    expect(
      viewerJoinFlags({
        ...base,
        requiresApproval: true,
        isPaid: true,
        requestStatus: "rejected",
        latestPaymentStatus: "pending",
      }),
    ).toMatchObject({ isPending: false });
  });

  it("puts the removal before Confirmed: a verified payment does not make a removed player confirmed", () => {
    const f = viewerJoinFlags({
      ...base,
      removed: true,
      isPaid: true,
      latestPaymentStatus: "verified",
    });
    expect(f).toMatchObject({
      hostDecides: true,
      approvalCleared: false,
      paymentCleared: true,
      isConfirmed: false,
      isPending: false,
    });
  });

  it("keeps a pending payment ahead of the removal, so the claim can still be withdrawn", () => {
    const f = viewerJoinFlags({
      ...base,
      removed: true,
      isPaid: true,
      latestPaymentStatus: "pending",
    });
    expect(f).toMatchObject({ isConfirmed: false, isPending: true });
  });

  it("shows the removed player's ask as a pending request the player can cancel", () => {
    expect(viewerJoinFlags({ ...base, removed: true, requestStatus: "pending" })).toMatchObject({
      isRequestPending: true,
      isPending: true,
    });
  });

  it("sends the tap to the host on an open game, and never to the pay page", () => {
    const isPaid = true;
    // The page's requiresApproval (games.$gameId.index.tsx): an open game, an adult inside any age range.
    const requiresApproval = viewerRequiresApproval({
      hostRequiresApproval: false,
      isHost: false,
      ageNeedsApproval: false,
      removed: true,
    });
    expect(requiresApproval).toBe(true);
    const f = viewerJoinFlags({ ...base, requiresApproval, removed: true, isPaid });
    // The page's preflight input, as games.$gameId.index.tsx builds it.
    const input = {
      inviteExpired: false,
      locked: false,
      lockedReason: "",
      spotsLeft: 3,
      asksParent: false,
      goesToPayment: isPaid && !f.paymentCleared && f.approvalCleared,
      asksHost: requiresApproval && !f.isApproved,
      requestHostId: "host",
      isInvite: false,
      inviteFrom: null,
    };
    expect(input.goesToPayment).toBe(false);
    expect(input.asksHost).toBe(true);
    expect(joinPreflightRefusal(input)).toBeNull();
    // A full roster still refuses before the request, as for any request.
    expect(joinPreflightRefusal({ ...input, spotsLeft: 0 })?.kind).toBe("full");
  });
});

describe("the removed player's words", () => {
  it("names the way back on the button and in the banner", () => {
    expect(REMOVED_ASK_LABEL).toBe("Ask the host to let you back in");
    const copy = (o: Partial<Parameters<typeof removedBannerCopy>[0]> = {}) =>
      removedBannerCopy({
        requestPending: false,
        capReached: false,
        cooldownLabel: null,
        attemptLimit: 3,
        paymentVerified: false,
        ...o,
      });
    expect(copy().title).toBe("The host removed you from this game");
    expect(copy().body).toMatch(/ask the host to let you back in/i);
    expect(copy().body).toMatch(/invite/i);
    expect(copy({ requestPending: true }).body).toMatch(/^You asked the host/);
    expect(copy({ capReached: true }).body).toMatch(/3-attempt limit/);
    expect(copy({ cooldownLabel: "12m" }).body).toMatch(/again in 12m\./);
    expect(copy({ paymentVerified: true }).body).toMatch(/payment is still recorded/);
  });

  it("does not offer an ask the page cannot send on a full or closed game", () => {
    const copy = (o: Partial<Parameters<typeof removedBannerCopy>[0]> = {}) =>
      removedBannerCopy({
        requestPending: false,
        capReached: false,
        cooldownLabel: null,
        attemptLimit: 3,
        paymentVerified: false,
        ...o,
      });
    const full = copy({ full: true }).body;
    expect(full).toMatch(/full right now/);
    expect(full).toMatch(/once a spot opens/);
    // The waitlist pickers skip a removed player (20261202100000), so the banner must not promise a notice.
    expect(full).toMatch(/waitlist won't tell you/i);
    expect(copy({ locked: true }).body).toMatch(/closed, so you can't ask to come back/);
    expect(copy({ locked: true, full: true }).body).toMatch(/closed/);
    // An ask already sent is said first, whatever the roster.
    expect(copy({ requestPending: true, full: true }).body).toMatch(/^You asked the host/);
  });

  it("tells the host who is asking", () => {
    expect(removedAskNotice("Thursday run")).toEqual({
      title: "Asks to be let back in: Thursday run",
      body: expect.stringMatching(/removed asked to come back/),
    });
  });

  it("words the join gate's refusal", () => {
    expect(USER_ERROR_MESSAGES.REMOVED_BY_HOST).toBe(REMOVED_BY_HOST_MESSAGE);
    expect(
      joinGateErrorMessage({
        code: "P0001",
        message: "REMOVED_BY_HOST: the host removed you from this game.",
      }),
    ).toBe(REMOVED_BY_HOST_MESSAGE);
  });
});

describe("removedFlowStatus: what the pill and the payment strip say to a removed player", () => {
  it("passes the shared status through for a player who was not removed", () => {
    expect(removedFlowStatus("payment_verified", false, "approved")).toBe("payment_verified");
    expect(removedFlowStatus("confirmed", false, null)).toBe("confirmed");
  });

  it("never says a removed player is in, whatever they paid", () => {
    expect(removedFlowStatus("payment_verified", true, null)).toBe("rejected");
    expect(removedFlowStatus("confirmed", true, "rejected")).toBe("rejected");
    expect(removedFlowStatus("payment_pending", true, null)).toBe("rejected");
  });

  it("keeps a payment still with the host, so its strip and withdraw stay", () => {
    expect(removedFlowStatus("payment_submitted", true, null)).toBe("payment_submitted");
    expect(removedFlowStatus("payment_rejected", true, "rejected")).toBe("payment_rejected");
  });

  it("shows the removed player's ask while it waits for the host", () => {
    expect(removedFlowStatus("rejected", true, "pending")).toBe("requested");
    expect(removedFlowStatus("none", true, "pending")).toBe("requested");
  });
});
