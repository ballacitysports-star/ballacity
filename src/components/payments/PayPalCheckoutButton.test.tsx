// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { GUARDIAN_PAYMENT_MESSAGE } from "@/lib/payments-policy";

/**
 * PayPal reports a failed createOrder only through onError, with its own generic
 * error. When the server refused to start the checkout for a reason written for
 * the player (a guardian has to approve the game first), that is what they see.
 */

const h = vi.hoisted(() => ({
  createOrder: vi.fn(),
  toastError: vi.fn(),
  buttons: null as null | {
    createOrder: () => Promise<string>;
    onError: (err: unknown) => void;
  },
}));

vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("@/lib/paypal.functions", () => ({
  createGamePayPalOrder: h.createOrder,
  captureGamePayPalOrder: vi.fn(),
}));

import { PayPalCheckoutButton } from "./PayPalCheckoutButton";

afterEach(() => {
  cleanup();
  h.toastError.mockReset();
  h.createOrder.mockReset();
  h.buttons = null;
});

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
});
