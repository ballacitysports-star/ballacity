import { describe, expect, it } from "vitest";
import { parseCaptureResponse, paypalPaymentMatches } from "./paypal.server";

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

describe("parseCaptureResponse (F04)", () => {
  const audit = {
    status: "COMPLETED",
    purchase_units: [
      {
        payments: {
          captures: [
            { id: "C", status: "PENDING", amount: { value: "10.00", currency_code: "USD" } },
          ],
        },
      },
    ],
  };

  it("reads the capture's status, not the order's (the audit's response)", () => {
    const r = parseCaptureResponse(audit);
    expect(r.status).toBe("PENDING");
    expect(r.orderStatus).toBe("COMPLETED");
    expect(r.captureId).toBe("C");
    expect(
      paypalPaymentMatches(
        { ...r, payeeMerchantId: "HOSTMERCHANT1" },
        { status: "COMPLETED", amountCents: 1000, currency: "USD", merchantId: "HOSTMERCHANT1" },
      ),
    ).toBe(false);
  });

  it("reports a missing capture and an ambiguous (multiple) capture as such", () => {
    expect(parseCaptureResponse({ status: "COMPLETED", purchase_units: [{}] }).status).toBe(
      "MISSING",
    );
    expect(parseCaptureResponse({}).status).toBe("MISSING");
    const two = {
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              { id: "A", status: "COMPLETED" },
              { id: "B", status: "COMPLETED" },
            ],
          },
        },
      ],
    };
    expect(parseCaptureResponse(two).status).toBe("AMBIGUOUS");
    expect(parseCaptureResponse(two).captureId).toBeNull();
  });

  it("keeps the capture's amount, currency, payee and decline reason", () => {
    const r = parseCaptureResponse({
      status: "COMPLETED",
      purchase_units: [
        {
          payee: { merchant_id: "UNIT-PAYEE" },
          payments: {
            captures: [
              {
                id: "X",
                status: "DECLINED",
                status_details: { reason: "DECLINED_BY_RISK_FRAUD_FILTERS" },
                amount: { value: "12.50", currency_code: "USD" },
              },
            ],
          },
        },
      ],
    });
    expect(r).toMatchObject({
      status: "DECLINED",
      amountValue: "12.50",
      currency: "USD",
      payeeMerchantId: "UNIT-PAYEE",
      statusReason: "DECLINED_BY_RISK_FRAUD_FILTERS",
    });
  });
});
