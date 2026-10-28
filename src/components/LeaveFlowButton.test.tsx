// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  status: "requested" as string,
  cancel: vi.fn(async (_id: string) => undefined),
  withdraw: vi.fn(async (_id: string) => undefined),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/game-flow-status", () => ({
  useMyFlowStatus: () => ({ status: h.status }),
  isUuid: () => true,
}));
vi.mock("@/lib/payments", () => ({
  cancelMyJoinRequest: h.cancel,
  withdrawMyApprovedJoinRequest: h.withdraw,
}));
vi.mock("@/lib/games-store", () => ({ leaveGame: vi.fn() }));
vi.mock("@/lib/leave-game", () => ({
  clearPendingSubmissions: vi.fn(async () => undefined),
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
