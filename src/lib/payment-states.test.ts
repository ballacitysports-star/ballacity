import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANCELLED_CLAIM_REVIEW_MESSAGE,
  DECLINED_CLAIM_REVIEW_MESSAGE,
  PAYMENT_STATES,
  PAYMENT_STATE_META,
  canHostConfirm,
  canPlayerCancel,
  canPlayerDispute,
  cancellationReasonLabel,
  isOpenPaymentState,
  paymentStateFor,
  rosterRowClaimStatus,
  settledClaimReviewRefusal,
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

describe("a host cannot mark a cancelled or declined claim paid (DECISION_FINAL, 20261125100000)", () => {
  it("refuses Mark as paid, in words, on a cancelled or declined latest claim", () => {
    expect(settledClaimReviewRefusal("cancelled", "verified")).toBe(CANCELLED_CLAIM_REVIEW_MESSAGE);
    expect(settledClaimReviewRefusal("rejected", "verified")).toBe(DECLINED_CLAIM_REVIEW_MESSAGE);
    expect(settledClaimReviewRefusal("cancelled", "pending")).toBe(CANCELLED_CLAIM_REVIEW_MESSAGE);
  });

  it("allows what the database allows: verifying a pending or disputed claim, declining, marking unpaid", () => {
    expect(settledClaimReviewRefusal("pending", "verified")).toBeNull();
    expect(settledClaimReviewRefusal("disputed", "verified")).toBeNull();
    expect(settledClaimReviewRefusal("cancelled", "rejected")).toBeNull();
    expect(settledClaimReviewRefusal("verified", "pending")).toBeNull();
  });

  it("reviewPaymentAction checks it before updating the existing claim", () => {
    const src = readFileSync("src/lib/payments.functions.ts", "utf8");
    const check = src.indexOf("settledClaimReviewRefusal(existing.status, next)");
    const update = src.indexOf(".update({\n        status: next,");
    expect(check).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(check);
  });

  it("the roster row keeps a cancelled claim as its own state, with no Mark as paid button", () => {
    expect(rosterRowClaimStatus("cancelled")).toBe("cancelled");
    expect(rosterRowClaimStatus("rejected")).toBe("rejected");
    expect(rosterRowClaimStatus("disputed")).toBeNull();
    expect(rosterRowClaimStatus(undefined)).toBeNull();
    const src = readFileSync("src/components/game-detail/RosterPlayerRow.tsx", "utf8");
    expect(src).toMatch(/const shown = rosterRowClaimStatus\(d\?\.status\);/);
    expect(src).toMatch(
      /paymentStatus === "cancelled" && \([\s\S]{0,400}Claim cancelled\. The player can send their payment again\./,
    );
    expect(src).toMatch(
      /paymentStatus === "none" && \([\s\S]{0,200}onClick=\{markPaidNoSubmission\}/,
    );
  });
});
