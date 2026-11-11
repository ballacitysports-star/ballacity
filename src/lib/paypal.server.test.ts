import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureOrder, paypalPaymentMatches } from "./paypal.server";

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

describe("captureOrder (review of task #69)", () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let captureReply: () => Response;

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/oauth2/token"))
        return new Response(JSON.stringify({ access_token: "T" }), { status: 200 });
      return captureReply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const completed = (captureStatus: string) =>
    JSON.stringify({
      id: "ORDER-1",
      status: "COMPLETED",
      purchase_units: [
        {
          payee: { merchant_id: "HOSTMERCHANT1" },
          payments: {
            captures: [
              {
                id: "CAPTURE-1",
                status: captureStatus,
                amount: { value: "10.00", currency_code: "USD" },
              },
            ],
          },
        },
      ],
    });

  it("asks PayPal for the full order in its answer, so the payee is in it", async () => {
    captureReply = () => new Response(completed("COMPLETED"), { status: 201 });
    await captureOrder("ORDER-1");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.Prefer).toBe("return=representation");
  });

  it("returns the capture's own status, not only the order's", async () => {
    captureReply = () => new Response(completed("PENDING"), { status: 201 });
    await expect(captureOrder("ORDER-1")).resolves.toMatchObject({
      status: "COMPLETED",
      captureId: "CAPTURE-1",
      captureStatus: "PENDING",
      payeeMerchantId: "HOSTMERCHANT1",
    });
  });

  it("throws when a successful answer cannot be read, so the caller asks PayPal what happened", async () => {
    captureReply = () => new Response("<html>gateway</html>", { status: 201 });
    await expect(captureOrder("ORDER-1")).rejects.toThrow();
    captureReply = () => new Response("{}", { status: 201 });
    await expect(captureOrder("ORDER-1")).rejects.toThrow();
  });
});
