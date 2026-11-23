// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/components/OpenInMaps", () => ({
  OpenInMaps: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/venue/VenueBadge", () => ({ VenueHostedAt: () => null }));

import { GamePaymentTerms } from "./GameInfoSections";
import { GamePolicySummary } from "@/components/games/GamePolicySummary";
import { normalizeGamePolicy, viewerGamePolicy } from "@/lib/game-policy";
import { payTermsView } from "@/lib/pay-entry-gate";

afterEach(cleanup);

const game = { id: "g1", price: 99, cancelCutoffMin: 120 } as never;
const terms = payTermsView({
  terms: {
    entryFee: 12.5,
    currency: "USD",
    paymentDeadline: "2026-12-01T18:00:00.000Z",
    methods: [
      { type: "venmo", name: "Venmo" },
      { type: "cashapp", name: "Cash App" },
    ],
    requiresApproval: true,
  },
  settingsReadable: false,
  isHost: false,
})!;

describe("the game page's payment area, for a viewer who cannot read the host's settings", () => {
  it("shows the deadline and the accepted apps by name beside the refund terms", () => {
    render(
      <GamePaymentTerms
        game={game}
        isPaid
        refundTerms={null}
        settings={null}
        paymentTerms={terms}
      />,
    );
    expect(screen.getByText("Payment deadline")).toBeTruthy();
    expect(screen.getByTestId("payment-terms-methods").textContent).toContain("Venmo, Cash App");
  });

  it("shows no deadline and no apps when nothing was told (the function missing, or a refused viewer)", () => {
    render(
      <GamePaymentTerms
        game={game}
        isPaid
        refundTerms={null}
        settings={null}
        paymentTerms={null}
      />,
    );
    expect(screen.queryByText("Payment deadline")).toBeNull();
    expect(screen.queryByTestId("payment-terms-methods")).toBeNull();
    expect(screen.getByText(/host hasn't posted refund terms yet/i)).toBeTruthy();
  });

  it("shows the settings row's own deadline, and no apps list, to a viewer who reads the row", () => {
    render(
      <GamePaymentTerms
        game={game}
        isPaid
        refundTerms={null}
        settings={
          {
            payment_deadline: "2027-01-01T00:00:00.000Z",
            payment_instructions: null,
            refund_policy: null,
          } as never
        }
        paymentTerms={terms}
      />,
    );
    expect(screen.getByText("Payment deadline")).toBeTruthy();
    expect(screen.queryByTestId("payment-terms-methods")).toBeNull();
  });
});

describe("'Before you join' for a viewer who cannot read the host's settings", () => {
  const policy = viewerGamePolicy({
    game,
    settings: null,
    requiresApproval: true,
    refundTerms: null,
    paymentTerms: terms,
  });

  it("states the fee PayPal charges, not the game's price, with the deadline and the apps, calmly", () => {
    render(<GamePolicySummary policy={policy} paymentTerms={terms} />);
    const text = screen.getByText(/per player, paid directly to the host/).textContent ?? "";
    expect(text).toContain("$12.50 per player");
    expect(text).not.toContain("$99");
    expect(text).toMatch(/Pay by /);
    expect(text).toContain("The host accepts Venmo and Cash App.");
  });

  it("is what it was with no terms: the game's price alone", () => {
    const plain = viewerGamePolicy({
      game,
      settings: null,
      requiresApproval: true,
      refundTerms: null,
    });
    render(<GamePolicySummary policy={plain} />);
    const text = screen.getByText(/per player, paid directly to the host/).textContent ?? "";
    expect(text).toContain("$99 per player");
    expect(text).not.toMatch(/Pay by|accepts/);
  });

  it("never carries a handle: the policy takes names and a date only", () => {
    const withHandle = normalizeGamePolicy({ entryFee: 5 });
    render(
      <GamePolicySummary
        policy={withHandle}
        paymentTerms={{ deadline: null, methodNames: ["Venmo"] }}
      />,
    );
    expect(screen.getByText(/The host accepts Venmo\./)).toBeTruthy();
  });
});
