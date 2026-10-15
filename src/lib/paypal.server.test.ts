import { describe, expect, it } from "vitest";
import { paypalPaymentMatches } from "./paypal.server";

const expected = {
  status: "APPROVED",
  amountCents: 1500,
  currency: "USD",
  merchantId: "HOSTMERCHANT1",
};

const order = {
  status: "APPROVED",
  amountValue: "15.00",
  currency: "USD",
  payeeMerchantId: "HOSTMERCHANT1",
};

describe("paypalPaymentMatches", () => {
  it("accepts an order paying the host the recorded amount", () => {
    expect(paypalPaymentMatches(order, expected)).toBe(true);
  });

  it("rejects a payee other than the host's connected account", () => {
    expect(paypalPaymentMatches({ ...order, payeeMerchantId: "OTHERMERCHANT" }, expected)).toBe(
      false,
    );
  });

  it("rejects a missing payee, even when the host has none connected", () => {
    expect(paypalPaymentMatches({ ...order, payeeMerchantId: null }, expected)).toBe(false);
    expect(
      paypalPaymentMatches({ ...order, payeeMerchantId: null }, { ...expected, merchantId: null }),
    ).toBe(false);
  });

  it("rejects when the host has disconnected PayPal", () => {
    expect(paypalPaymentMatches(order, { ...expected, merchantId: undefined })).toBe(false);
  });

  it("rejects a different amount or currency", () => {
    expect(paypalPaymentMatches({ ...order, amountValue: "14.99" }, expected)).toBe(false);
    expect(paypalPaymentMatches({ ...order, amountValue: null }, expected)).toBe(false);
    expect(paypalPaymentMatches({ ...order, currency: "EUR" }, expected)).toBe(false);
  });

  it("rejects an order not in the expected status", () => {
    expect(paypalPaymentMatches({ ...order, status: "CREATED" }, expected)).toBe(false);
    expect(paypalPaymentMatches(order, { ...expected, status: "COMPLETED" })).toBe(false);
  });
});
