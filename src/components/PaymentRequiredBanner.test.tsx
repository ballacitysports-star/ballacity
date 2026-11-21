// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GamePaymentSettings } from "@/lib/payments";
import { gameTakesNoPayment } from "@/lib/pay-entry-gate";

/**
 * The game page's "Payment required" banner offers a way to pay ("Pay $X now", "Resubmit payment"). On a game that
 * takes no payment (a cancelled game, or an ended one without a place: gameTakesNoPayment) it used to offer it anyway,
 * and the pay page then only said "You can't pay for this game". It offers nothing there now.
 */

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

import { PaymentRequiredBanner } from "./PaymentRequiredBanner";

const settings: GamePaymentSettings = {
  id: "s",
  game_id: "g",
  host_id: "h",
  entry_fee: 15,
  accepted_method_ids: [],
  payment_deadline: null,
  refund_policy: null,
  payment_instructions: null,
  requires_approval: true,
} as GamePaymentSettings;

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("PaymentRequiredBanner", () => {
  it("offers to pay an approved, unpaid player on a game that takes payment", () => {
    render(
      <PaymentRequiredBanner
        gameId="g"
        settings={settings}
        status="payment_pending"
        takesPayment={!gameTakesNoPayment("open", false)}
      />,
    );
    const pay = screen.getByRole("button", { name: /pay \$15 now/i });
    fireEvent.click(pay);
    expect(navigate).toHaveBeenCalledWith({ to: "/games/$gameId/pay", params: { gameId: "g" } });
  });

  it("offers no payment on a cancelled game, to a player with or without a place", () => {
    for (const holdsPlace of [false, true]) {
      for (const status of ["payment_pending", "payment_rejected"] as const) {
        const { container } = render(
          <PaymentRequiredBanner
            gameId="g"
            settings={settings}
            status={status}
            takesPayment={!gameTakesNoPayment("cancelled", holdsPlace)}
          />,
        );
        expect(container.innerHTML).toBe("");
        cleanup();
      }
    }
  });

  it("offers no payment on an ended game to a player without a place, and keeps it for one on the roster", () => {
    const ended = render(
      <PaymentRequiredBanner
        gameId="g"
        settings={settings}
        status="payment_pending"
        takesPayment={!gameTakesNoPayment("completed", false)}
      />,
    );
    expect(ended.container.innerHTML).toBe("");
    cleanup();
    render(
      <PaymentRequiredBanner
        gameId="g"
        settings={settings}
        status="payment_rejected"
        takesPayment={!gameTakesNoPayment("completed", true)}
      />,
    );
    expect(screen.getByRole("button", { name: /resubmit payment/i })).toBeTruthy();
  });
});
