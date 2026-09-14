import { describe, it, expect } from "vitest";
import { feeBreakdownLines, isPaymentMode, quoteFees } from "./fees";
import { DEFAULT_MONETIZATION_CONFIG, resolveMonetizationConfig } from "./config";

describe("direct host payments", () => {
  it("never adds a fee to money ballaCity does not touch", () => {
    const q = quoteFees({ amountCents: 1500, mode: "direct_host" });
    expect(q.processingFeeCents).toBe(0);
    expect(q.platformFeeCents).toBe(0);
    expect(q.totalCents).toBe(1500);
    expect(q.hostReceivesCents).toBe(1500);
  });

  it("shows only the game fee and total in the breakdown", () => {
    expect(feeBreakdownLines(quoteFees({ amountCents: 1500, mode: "direct_host" }))).toEqual([
      { label: "Game fee", value: "$15.00" },
      { label: "Total", value: "$15.00" },
    ]);
  });

  it("is the default mode and the only one enabled today", () => {
    expect(DEFAULT_MONETIZATION_CONFIG.ballacityProcessedPaymentsEnabled).toBe(false);
  });
});

describe("ballaCity-processed payments", () => {
  it("is transparent: subtotal + processing + platform = total", () => {
    const q = quoteFees({ amountCents: 2000, mode: "ballacity_processed" });
    expect(q.processingFeeCents).toBe(Math.round(2000 * 0.029) + 30);
    expect(q.platformFeeCents).toBe(100);
    expect(q.totalCents).toBe(q.subtotalCents + q.processingFeeCents + q.platformFeeCents);
    expect(q.hostReceivesCents).toBe(2000);
  });

  it("applies the platform fee floor and ceiling", () => {
    expect(quoteFees({ amountCents: 100, mode: "ballacity_processed" }).platformFeeCents).toBe(50);
    expect(quoteFees({ amountCents: 1_000_00, mode: "ballacity_processed" }).platformFeeCents).toBe(
      2500,
    );
  });

  it("charges nothing on a free game", () => {
    expect(quoteFees({ amountCents: 0, mode: "ballacity_processed" }).totalCents).toBe(0);
  });

  it("uses admin fee overrides rather than hard-coded numbers", () => {
    const config = resolveMonetizationConfig({ fees: { platformFeeBps: 1000 } });
    expect(quoteFees({ amountCents: 2000, mode: "ballacity_processed" }, config).platformFeeCents).toBe(
      200,
    );
  });
});

describe("payment mode parsing", () => {
  it("rejects anything that is not a known mode", () => {
    expect(isPaymentMode("direct_host")).toBe(true);
    expect(isPaymentMode("ballacity_processed")).toBe(true);
    expect(isPaymentMode("free")).toBe(false);
    expect(isPaymentMode(undefined)).toBe(false);
  });
});
