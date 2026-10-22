// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PaymentHealth } from "@/lib/payment-health";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
const loadHealth = vi.fn();
vi.mock("@/lib/superadmin.functions", () => ({
  superadminPaymentHealth: (a: unknown) => loadHealth(a),
}));

import { PaymentHealthCard } from "./PaymentHealthCard";

const health = (over: Partial<PaymentHealth> = {}): PaymentHealth => ({
  days: 90,
  since: "2026-07-24T00:00:00Z",
  submissions: {
    total: 6,
    verified: 3,
    pending: 1,
    rejected: 0,
    cancelled: 2,
    disputed: 1,
    dispute_rate_pct: 16.7,
    verified_dollars: 40,
  },
  by_type: [{ payment_type: "venmo", submissions: 5, verified: 2, disputed: 1 }],
  refunds: {
    owed_now_count: 2,
    owed_now_dollars: 20,
    owed_overdue_count: 1,
    owed_overdue_dollars: 10,
    sent_in_window: 4,
    kept_in_window: 0,
  },
  host_cancellations: {
    games_that_took_payment: 4,
    games_cancelled_after_payment: 2,
    players_affected: 2,
    dollars_affected: 20,
    rate_pct: 50,
  },
  repeat_hosts: [
    {
      host_id: "11111111-aaaa-bbbb-cccc-dddddddddddd",
      display_name: "Alex Host",
      cancelled_games: 2,
      disputes: 0,
      overdue_refunds: 1,
      problems: 3,
    },
  ],
  ...over,
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PaymentHealthCard />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  loadHealth.mockReset();
});

describe("PaymentHealthCard", () => {
  it("shows the headline rates, refunds owed and repeat hosts", async () => {
    loadHealth.mockResolvedValue(health());
    renderCard();
    expect(await screen.findByText("50%")).toBeTruthy();
    expect(screen.getByText(/2 of 4 paid games/)).toBeTruthy();
    expect(screen.getByText("16.7%")).toBeTruthy();
    expect(screen.getByText(/1 over 3 days \(\$10\.00\)/)).toBeTruthy();
    expect(screen.getByText("Alex Host")).toBeTruthy();
    expect(screen.getByText(/5 submitted · 2 verified · 1 disputed/)).toBeTruthy();
    expect(loadHealth).toHaveBeenCalledWith({ data: { days: 90 } });
  });

  it("shows a dash instead of a rate when nothing was paid", async () => {
    loadHealth.mockResolvedValue(
      health({
        host_cancellations: {
          games_that_took_payment: 0,
          games_cancelled_after_payment: 0,
          players_affected: 0,
          dollars_affected: 0,
          rate_pct: null,
        },
        submissions: { ...health().submissions, total: 0, disputed: 0, dispute_rate_pct: null },
        by_type: [],
        repeat_hosts: [],
      }),
    );
    renderCard();
    expect((await screen.findAllByText("—")).length).toBe(2);
    expect(screen.getByText("No payments in this window.")).toBeTruthy();
    expect(screen.getByText("None with two or more problems.")).toBeTruthy();
  });

  it("reloads for the window the admin picks", async () => {
    loadHealth.mockResolvedValue(health());
    renderCard();
    await screen.findByText("50%");
    fireEvent.click(screen.getByRole("button", { name: "365d" }));
    await waitFor(() => expect(loadHealth).toHaveBeenCalledWith({ data: { days: 365 } }));
  });

  it("says so when the numbers can't be loaded", async () => {
    loadHealth.mockRejectedValue(new Error("nope"));
    renderCard();
    expect(await screen.findByText("Couldn't load payment health.")).toBeTruthy();
  });
});
