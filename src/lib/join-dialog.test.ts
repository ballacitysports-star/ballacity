import { describe, expect, it, vi } from "vitest";
import {
  AGREE_AND_JOIN_ACTION,
  JOIN_GAME_ACTION,
  JOIN_GAME_TITLE,
  canConfirmJoin,
  isFreeInstantJoin,
  joinGameActionLabel,
  joinTapRoute,
  recordAckThenJoin,
} from "./join-dialog";
import { joinTapStep, type JoinPreflightInput } from "./join-preflight";

describe("join dialog copy", () => {
  it("says game, not run", () => {
    expect(JOIN_GAME_TITLE).toBe("Join this game?");
    expect(JOIN_GAME_ACTION).toBe("Join game");
    expect(`${JOIN_GAME_TITLE} ${JOIN_GAME_ACTION}`).not.toMatch(/\brun\b/i);
  });

  it("uses the acknowledgment's own wording when it is due", () => {
    expect(joinGameActionLabel(true)).toBe(AGREE_AND_JOIN_ACTION);
    expect(AGREE_AND_JOIN_ACTION).toBe("Agree & join");
    expect(joinGameActionLabel(false)).toBe(JOIN_GAME_ACTION);
  });
});

describe("canConfirmJoin", () => {
  it("stays disabled until the acknowledgment is ticked", () => {
    expect(canConfirmJoin({ needsAck: true, checked: false, submitting: false })).toBe(false);
    expect(canConfirmJoin({ needsAck: true, checked: true, submitting: false })).toBe(true);
  });

  it("needs no tick when the current version is already on file", () => {
    expect(canConfirmJoin({ needsAck: false, checked: false, submitting: false })).toBe(true);
  });

  it("is disabled while submitting, ticked or not", () => {
    expect(canConfirmJoin({ needsAck: true, checked: true, submitting: true })).toBe(false);
    expect(canConfirmJoin({ needsAck: false, checked: false, submitting: true })).toBe(false);
  });
});

describe("isFreeInstantJoin", () => {
  it("is only a join with no parent, no host approval and no fee", () => {
    expect(isFreeInstantJoin({ asksParent: false, asksHost: false, isPaid: false })).toBe(true);
    expect(isFreeInstantJoin({ asksParent: true, asksHost: false, isPaid: false })).toBe(false);
    expect(isFreeInstantJoin({ asksParent: false, asksHost: true, isPaid: false })).toBe(false);
    expect(isFreeInstantJoin({ asksParent: false, asksHost: false, isPaid: true })).toBe(false);
  });
});

describe("joinTapRoute", () => {
  const open: JoinPreflightInput = {
    inviteExpired: false,
    locked: false,
    lockedReason: "Signup closed",
    spotsLeft: 3,
    asksParent: false,
    goesToPayment: false,
    asksHost: false,
    requestHostId: "host-1",
    isInvite: false,
    inviteFrom: null,
  };
  const free = { freeInstantJoin: true, confirm: true };

  it("free game, acknowledgment due: one dialog with the acknowledgment", () => {
    const step = joinTapStep({ ...open, needsRiskAck: true });
    expect(joinTapRoute(step, free)).toEqual({ route: "join-dialog", needsAck: true });
    // "Join as {position}" (no confirm) gets the same merged dialog.
    expect(joinTapRoute(step, { freeInstantJoin: true, confirm: false })).toEqual({
      route: "join-dialog",
      needsAck: true,
    });
  });

  it("free game, current version on file: the dialog without the checkbox", () => {
    const step = joinTapStep({ ...open, needsRiskAck: false });
    expect(joinTapRoute(step, free)).toEqual({ route: "join-dialog", needsAck: false });
    // "Join as {position}" still joins straight away, as before.
    expect(joinTapRoute(step, { freeInstantJoin: true, confirm: false })).toEqual({
      route: "join",
    });
  });

  it("requests, parent asks and paid joins keep the standalone Before you join", () => {
    const step = joinTapStep({ ...open, asksHost: true, needsRiskAck: true });
    expect(joinTapRoute(step, { freeInstantJoin: false, confirm: false })).toEqual({
      route: "risk-dialog",
    });
    expect(joinTapRoute(step, { freeInstantJoin: false, confirm: true })).toEqual({
      route: "risk-dialog",
    });
    const noAck = joinTapStep({ ...open, asksHost: true, needsRiskAck: false });
    expect(joinTapRoute(noAck, { freeInstantJoin: false, confirm: false })).toEqual({
      route: "join",
    });
  });

  it("a refusal wins over any dialog, so nothing is acknowledged for a refused join", () => {
    for (const input of [
      { ...open, spotsLeft: 0 },
      { ...open, locked: true },
      { ...open, inviteExpired: true },
    ]) {
      const step = joinTapStep({ ...input, needsRiskAck: true });
      expect(joinTapRoute(step, free).route).toBe("refuse");
    }
  });

  it("never skips a due acknowledgment", () => {
    const step = joinTapStep({ ...open, needsRiskAck: true });
    for (const freeInstantJoin of [true, false]) {
      for (const confirm of [true, false]) {
        const r = joinTapRoute(step, { freeInstantJoin, confirm });
        expect(r.route === "risk-dialog" || (r.route === "join-dialog" && r.needsAck)).toBe(true);
      }
    }
  });
});

describe("recordAckThenJoin (free game, acknowledgment due)", () => {
  it("records the acknowledgment first and joins only after the write has succeeded", async () => {
    const order: string[] = [];
    let release!: () => void;
    const recordAck = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push("ack:start");
          release = () => {
            order.push("ack:done");
            resolve();
          };
        }),
    );
    const join = vi.fn(async () => {
      order.push("join");
    });
    const pending = recordAckThenJoin({ recordAck, join });
    await Promise.resolve();
    expect(join).not.toHaveBeenCalled();
    release();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(order).toEqual(["ack:start", "ack:done", "join"]);
  });

  it("a failed acknowledgment write joins nothing and reports the ack stage", async () => {
    const error = new Error("500");
    const join = vi.fn(async () => {});
    const result = await recordAckThenJoin({ recordAck: () => Promise.reject(error), join });
    expect(result).toEqual({ ok: false, stage: "ack", error });
    expect(join).not.toHaveBeenCalled();
  });

  it("a failed join after the acknowledgment reports the join stage", async () => {
    const error = new Error("full");
    const result = await recordAckThenJoin({
      recordAck: async () => {},
      join: () => Promise.reject(error),
    });
    expect(result).toEqual({ ok: false, stage: "join", error });
  });
});
