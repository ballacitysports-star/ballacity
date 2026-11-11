// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  CHECKOUT_UNCONFIRMED_MESSAGE,
  GUARDIAN_PAYMENT_MESSAGE,
  PAYMENT_PRECONDITION_MESSAGES,
  PAYMENT_REFUNDED_MESSAGE,
} from "@/lib/payments-policy";

/**
 * PayPal reports a failed createOrder only through onError, with its own generic
 * error. When the server refused to start the checkout for a reason written for
 * the player (a guardian has to approve the game first), that is what they see.
 */

const h = vi.hoisted(() => ({
  createOrder: vi.fn(),
  captureOrder: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  buttons: null as null | {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError: (err: unknown) => void;
  },
}));

vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock("@/lib/paypal.functions", () => ({
  createGamePayPalOrder: h.createOrder,
  captureGamePayPalOrder: h.captureOrder,
}));

import { PayPalCheckoutButton } from "./PayPalCheckoutButton";

afterEach(() => {
  cleanup();
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.createOrder.mockReset();
  h.captureOrder.mockReset();
  h.buttons = null;
});

async function renderButton() {
  window.paypal = {
    Buttons: (opts: NonNullable<typeof h.buttons>) => {
      h.buttons = opts;
      return { render: () => Promise.resolve() };
    },
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <PayPalCheckoutButton
      gameId="g1"
      clientId="client"
      merchantId="HOSTMERCHANT1"
      feeLabel="$10"
      onPaid={() => {}}
    />,
  );
  await waitFor(() => expect(h.buttons).not.toBeNull());
}

async function startCheckout(refusal: Error) {
  window.paypal = {
    Buttons: (opts: NonNullable<typeof h.buttons>) => {
      h.buttons = opts;
      return { render: () => Promise.resolve() };
    },
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.createOrder.mockRejectedValue(refusal);
  render(
    <PayPalCheckoutButton
      gameId="g1"
      clientId="client"
      merchantId="HOSTMERCHANT1"
      feeLabel="$10"
      onPaid={() => {}}
    />,
  );
  await waitFor(() => expect(h.buttons).not.toBeNull());
  // What the PayPal SDK does: call createOrder, and on a rejection call onError with its own error.
  await expect(h.buttons!.createOrder()).rejects.toBe(refusal);
  h.buttons!.onError(new Error("Expected an order id to be passed"));
}

describe("PayPalCheckoutButton", () => {
  it("shows the guardian message when the server refuses to start the checkout", async () => {
    await startCheckout(new Error(GUARDIAN_PAYMENT_MESSAGE));
    expect(h.toastError).toHaveBeenCalledWith(GUARDIAN_PAYMENT_MESSAGE);
  });

  it("keeps the generic message for any other failure", async () => {
    await startCheckout(new Error("PayPal order failed (422)."));
    expect(h.toastError).toHaveBeenCalledWith("PayPal checkout hit a problem. Try another method.");
  });

  it("shows a payment-rule message when the server refuses to start the checkout", async () => {
    await startCheckout(new Error(PAYMENT_PRECONDITION_MESSAGES.HOST_APPROVAL_REQUIRED));
    expect(h.toastError).toHaveBeenCalledWith(PAYMENT_PRECONDITION_MESSAGES.HOST_APPROVAL_REQUIRED);
  });

  it("after approval, shows the server's message for the player when the capture is refused", async () => {
    await renderButton();
    h.captureOrder.mockRejectedValue(new Error(PAYMENT_REFUNDED_MESSAGE));
    await h.buttons!.onApprove({ orderID: "ORDER-1" });
    expect(h.toastError).toHaveBeenCalledWith(PAYMENT_REFUNDED_MESSAGE);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("never shows PayPal's own error text after approval", async () => {
    await renderButton();
    h.captureOrder.mockRejectedValue(new Error("PayPal capture failed (422)."));
    await h.buttons!.onApprove({ orderID: "ORDER-1" });
    expect(h.toastError).toHaveBeenCalledWith(CHECKOUT_UNCONFIRMED_MESSAGE);
  });

  it("does not say the player is in when the roster place was not given", async () => {
    await renderButton();
    h.captureOrder.mockResolvedValue({ ok: true, already: false, rostered: false });
    await h.buttons!.onApprove({ orderID: "ORDER-1" });
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Payment confirmed. The host will confirm your place on the roster.",
    );
  });
});
