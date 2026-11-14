import { describe, expect, it } from "vitest";
import {
  GAME_FULL_MESSAGE,
  INVITE_EXPIRED_MESSAGE,
  INVITE_TAMPERED_MESSAGE,
  NO_REQUEST_HOST_MESSAGE,
  joinPreflightRefusal,
  joinTapStep,
  type JoinPreflightInput,
} from "./join-preflight";

const HOST = "host-1";

/** An open, approval-gated game reached from a valid invite: nothing to refuse. */
const base: JoinPreflightInput = {
  inviteExpired: false,
  locked: false,
  lockedReason: "The host has closed joining for this game.",
  spotsLeft: 3,
  asksParent: false,
  goesToPayment: false,
  asksHost: true,
  requestHostId: HOST,
  isInvite: true,
  inviteFrom: HOST,
};

describe("joinTapStep: refusals come before the risk acknowledgment", () => {
  it("asks for the acknowledgment when the join could go ahead", () => {
    expect(joinTapStep({ ...base, needsRiskAck: true })).toEqual({ step: "acknowledge" });
  });

  it("refuses an expired invite instead of opening the dialog", () => {
    expect(joinTapStep({ ...base, inviteExpired: true, needsRiskAck: true })).toEqual({
      step: "refuse",
      refusal: { kind: "invite_expired", message: INVITE_EXPIRED_MESSAGE, redirectTo: "/discover" },
    });
  });

  it("refuses an invite link without `from` instead of opening the dialog", () => {
    expect(joinTapStep({ ...base, inviteFrom: undefined, needsRiskAck: true })).toEqual({
      step: "refuse",
      refusal: { kind: "invite_tampered", message: INVITE_TAMPERED_MESSAGE },
    });
  });

  it("refuses an invite link whose `from` is not the host instead of opening the dialog", () => {
    expect(joinTapStep({ ...base, inviteFrom: "someone-else", needsRiskAck: true })).toEqual({
      step: "refuse",
      refusal: { kind: "invite_tampered", message: INVITE_TAMPERED_MESSAGE },
    });
  });

  it("refuses a locked game and a full roster instead of opening the dialog", () => {
    expect(joinTapStep({ ...base, locked: true, needsRiskAck: true })).toEqual({
      step: "refuse",
      refusal: { kind: "locked", message: base.lockedReason },
    });
    expect(joinTapStep({ ...base, spotsLeft: 0, needsRiskAck: true })).toEqual({
      step: "refuse",
      refusal: { kind: "full", message: GAME_FULL_MESSAGE },
    });
  });

  it("leaves everything to the join itself when no acknowledgment is pending", () => {
    // Leaving, cancelling and already-acknowledged joins keep their own guards.
    expect(joinTapStep({ ...base, inviteExpired: true, needsRiskAck: false })).toEqual({
      step: "join",
    });
    expect(joinTapStep({ ...base, needsRiskAck: false })).toEqual({ step: "join" });
  });
});

describe("joinPreflightRefusal: same order as executeJoinAction", () => {
  it("is null for a valid invite on an open game", () => {
    expect(joinPreflightRefusal(base)).toBeNull();
  });

  it("puts an expired invite first, ahead of a tampered link, a lock and a full roster", () => {
    expect(
      joinPreflightRefusal({
        ...base,
        inviteExpired: true,
        inviteFrom: "someone-else",
        locked: true,
        spotsLeft: 0,
      })?.kind,
    ).toBe("invite_expired");
  });

  it("checks the lock, then the roster, then the request's host, then the invite link", () => {
    const all = { ...base, locked: true, spotsLeft: 0, requestHostId: null, inviteFrom: "x" };
    expect(joinPreflightRefusal(all)?.kind).toBe("locked");
    expect(joinPreflightRefusal({ ...all, locked: false })?.kind).toBe("full");
    expect(joinPreflightRefusal({ ...all, locked: false, spotsLeft: 1 })).toEqual({
      kind: "no_request_host",
      message: NO_REQUEST_HOST_MESSAGE,
    });
    expect(
      joinPreflightRefusal({ ...all, locked: false, spotsLeft: 1, requestHostId: HOST })?.kind,
    ).toBe("invite_tampered");
  });

  it("checks the invite link only for a host request, and only on an invite", () => {
    // A free, no-approval join has no request host to match `from` against.
    expect(joinPreflightRefusal({ ...base, asksHost: false, inviteFrom: "x" })).toBeNull();
    // Opening the game without an invite has nothing to tamper with.
    expect(joinPreflightRefusal({ ...base, isInvite: false, inviteFrom: undefined })).toBeNull();
  });

  it("asks the parent after the lock, roster and host checks, without the invite-link check", () => {
    const parent = { ...base, asksParent: true, asksHost: false, inviteFrom: "x" };
    expect(joinPreflightRefusal(parent)).toBeNull();
    expect(joinPreflightRefusal({ ...parent, locked: true })?.kind).toBe("locked");
    expect(joinPreflightRefusal({ ...parent, spotsLeft: 0 })?.kind).toBe("full");
    expect(joinPreflightRefusal({ ...parent, requestHostId: null })?.kind).toBe("no_request_host");
    expect(joinPreflightRefusal({ ...parent, inviteExpired: true })?.kind).toBe("invite_expired");
  });

  it("leaves a payment step to the pay page, except for an expired invite", () => {
    const pay = { ...base, goesToPayment: true, asksHost: false, locked: true, spotsLeft: 0 };
    expect(joinPreflightRefusal(pay)).toBeNull();
    expect(joinPreflightRefusal({ ...pay, inviteExpired: true })?.kind).toBe("invite_expired");
  });
});
