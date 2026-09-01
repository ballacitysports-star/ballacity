import { describe, expect, it } from "vitest";
import {
  PAYMENT_STATES,
  PAYMENT_STATE_META,
  canHostConfirm,
  canPlayerCancel,
  canPlayerDispute,
  cancellationReasonLabel,
  isOpenPaymentState,
  paymentStateFor,
} from "./payment-states";

describe("canonical payment states", () => {
  it("has copy for all seven states", () => {
    expect(PAYMENT_STATES).toHaveLength(7);
    for (const s of PAYMENT_STATES) {
      expect(PAYMENT_STATE_META[s].label.length).toBeGreaterThan(0);
      expect(PAYMENT_STATE_META[s].playerHint.length).toBeGreaterThan(0);
      expect(PAYMENT_STATE_META[s].hostHint.length).toBeGreaterThan(0);
    }
  });

  it("maps a free game to confirmed", () => {
    expect(paymentStateFor({ feeRequired: false })).toBe("confirmed");
  });

  it("starts a paid game at payment required, then instructions", () => {
    expect(paymentStateFor({ feeRequired: true })).toBe("payment_required");
    expect(paymentStateFor({ feeRequired: true, instructionsShown: true })).toBe(
      "instructions_shown",
    );
  });

  it("puts a submitted claim in host confirmation, never confirmed", () => {
    const state = paymentStateFor({ feeRequired: true, submission: { status: "pending" } });
    expect(state).toBe("host_confirmation_pending");
    expect(state).not.toBe("confirmed");
  });

  it("only host verification produces confirmed", () => {
    expect(paymentStateFor({ feeRequired: true, submission: { status: "verified" } })).toBe(
      "confirmed",
    );
  });

  it("maps disputed and cancelled through", () => {
    expect(paymentStateFor({ feeRequired: true, submission: { status: "disputed" } })).toBe(
      "disputed",
    );
    expect(paymentStateFor({ feeRequired: true, submission: { status: "cancelled" } })).toBe(
      "cancelled",
    );
  });

  it("a declined claim returns the player to payment required", () => {
    expect(paymentStateFor({ feeRequired: true, submission: { status: "rejected" } })).toBe(
      "payment_required",
    );
  });
});

describe("permitted transitions", () => {
  it("lets a player cancel or dispute an awaiting claim", () => {
    expect(canPlayerCancel("host_confirmation_pending")).toBe(true);
    expect(canPlayerDispute("host_confirmation_pending")).toBe(true);
  });

  it("does not let a player act on a settled claim", () => {
    expect(canPlayerCancel("confirmed")).toBe(false);
    expect(canPlayerCancel("cancelled")).toBe(false);
    expect(canPlayerDispute("cancelled")).toBe(false);
  });

  it("lets a host confirm only while a claim is open", () => {
    expect(canHostConfirm("host_confirmation_pending")).toBe(true);
    expect(canHostConfirm("confirmed")).toBe(false);
    expect(canHostConfirm("cancelled")).toBe(false);
  });

  it("treats confirmed and cancelled as closed", () => {
    expect(isOpenPaymentState("confirmed")).toBe(false);
    expect(isOpenPaymentState("cancelled")).toBe(false);
    expect(isOpenPaymentState("disputed")).toBe(true);
  });
});

describe("cancellation reasons", () => {
  it("labels known reasons and falls back safely", () => {
    expect(cancellationReasonLabel("weather")).toBe("Weather");
    expect(cancellationReasonLabel("game_cancelled")).toBe("Game cancelled");
    expect(cancellationReasonLabel(null)).toBe("Cancelled");
    expect(cancellationReasonLabel("nonsense")).toBe("Cancelled");
  });
});
