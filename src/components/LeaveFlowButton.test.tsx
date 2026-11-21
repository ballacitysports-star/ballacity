// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  status: "requested" as string,
  cancel: vi.fn(async (_id: string) => undefined),
  withdraw: vi.fn(async (_id: string) => undefined),
  clearSubs: vi.fn(async (_id: string) => undefined),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/game-flow-status", () => ({
  useMyFlowStatus: () => ({ status: h.status }),
  isGameId: () => true,
}));
vi.mock("@/lib/payments", () => ({
  cancelMyJoinRequest: h.cancel,
  withdrawMyApprovedJoinRequest: h.withdraw,
}));
vi.mock("@/lib/games-store", () => ({ leaveGame: vi.fn() }));
vi.mock("@/lib/leave-game", () => ({
  clearPendingSubmissions: h.clearSubs,
  notifyHostOfLeave: vi.fn(async () => undefined),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  },
}));

import { LeaveFlowButton } from "./LeaveFlowButton";

beforeEach(() => {
  h.status = "requested";
  h.cancel.mockClear();
  h.withdraw.mockClear();
  h.clearSubs.mockClear();
});
afterEach(cleanup);

describe("LeaveFlowButton on a request that is waiting for the host", () => {
  it("offers a clear Cancel request button and takes the request back after confirming", async () => {
    const done = vi.fn();
    render(<LeaveFlowButton gameId="g1" gameTitle="Paid run" variant="danger" onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel request/i }));
    expect(screen.getByText("Cancel your request?")).toBeTruthy();
    expect(h.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: /cancel request/i }).at(-1)!);
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith("g1"));
    expect(h.withdraw).not.toHaveBeenCalled();
    await waitFor(() => expect(done).toHaveBeenCalled());
  });

  it("shows nothing when the player has no request or spot", () => {
    h.status = "none";
    const { container } = render(
      <LeaveFlowButton gameId="g1" gameTitle="Paid run" variant="danger" />,
    );
    expect(container.innerHTML).toBe("");
  });
});

// Task #71 review: on a paid open game a guarded minor's request to their parent stays pending after they pay. The
// flow status now reads "payment_submitted" there, so the way out withdraws the payment, not only the request.
describe("LeaveFlowButton once a payment is sent", () => {
  it("withdraws: clears the pending payment and the request to the parent", async () => {
    h.status = "payment_submitted";
    render(<LeaveFlowButton gameId="g1" gameTitle="Paid run" variant="danger" />);
    fireEvent.click(screen.getByRole("button", { name: /withdraw from game/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /withdraw/i }).at(-1)!);
    await waitFor(() => expect(h.clearSubs).toHaveBeenCalledWith("g1"));
    expect(h.withdraw).toHaveBeenCalledWith("g1");
    expect(h.cancel).toHaveBeenCalledWith("g1");
  });

  it("leaving a spot also drops a request to the parent, so rejoining asks again", async () => {
    h.status = "payment_verified";
    render(<LeaveFlowButton gameId="g1" gameTitle="Paid run" variant="danger" />);
    fireEvent.click(screen.getByRole("button", { name: /leave game/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /leave game/i }).at(-1)!);
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith("g1"));
    expect(h.clearSubs).not.toHaveBeenCalled();
  });
});
