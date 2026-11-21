// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { JoinRequest } from "@/lib/payments";
import type { Game } from "@/lib/sample-data";

/**
 * P2-6 "remove 1 Hz interval": the resubmit countdown after a declined join
 * request ticks inside GameApprovalBanner, not in GameDetail. The page around
 * the banner must not re-render every second for the 15-minute cooldown.
 */

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/LeaveFlowButton", () => ({ LeaveFlowButton: () => null }));

const { useResubmitCooldownMs } = await import("@/hooks/use-resubmit-cooldown");
const { GameApprovalBanner } = await import("@/components/game-detail/GameApprovalBanner");
const { JOIN_RESUBMIT_COOLDOWN_MS } = await import("@/lib/payments");

const NOW = new Date("2026-11-10T12:00:00Z").getTime();

function request(status: JoinRequest["status"], secondsLeft = 0): JoinRequest {
  return {
    id: "r1",
    game_id: "g1",
    player_id: "p1",
    host_id: "h1",
    status,
    message: null,
    reviewer_notes: null,
    created_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
    reviewed_at: null,
    attempt_count: 1,
    last_rejected_at:
      status === "rejected"
        ? new Date(NOW - JOIN_RESUBMIT_COOLDOWN_MS + secondsLeft * 1000).toISOString()
        : null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useResubmitCooldownMs", () => {
  it("is 0 and runs no clock without a declined request in its cooldown", () => {
    for (const req of [null, request("pending"), request("approved"), request("rejected", 0)]) {
      const { result, unmount } = renderHook(() => useResubmitCooldownMs(req));
      expect(result.current).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      unmount();
    }
  });

  it("counts down once a second, then stops its clock", () => {
    const req = request("rejected", 3);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useResubmitCooldownMs(req);
    });
    expect(result.current).toBe(3000);
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(2000);
    expect(renders).toBe(2);

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const settled = renders;
    act(() => vi.advanceTimersByTime(5000));
    expect(renders).toBe(settled);
  });
});

describe("GameApprovalBanner countdown", () => {
  it("updates its own text each second while the page around it renders once", () => {
    let pageRenders = 0;
    const req = request("rejected", 5);
    function Page() {
      pageRenders += 1;
      return (
        <GameApprovalBanner
          capReached={false}
          fee={0}
          game={{ id: "g1", title: "Sunday run" } as Game}
          isHost={false}
          isPaid={false}
          isPaymentVerified={false}
          myFlowStatus="rejected"
          myHoldLabel={null}
          myReq={req}
          myWait={null}
          refreshStatus={async () => {}}
          requiresApproval
        />
      );
    }
    render(<Page />);
    expect(screen.getByText("You can resubmit in 5s.")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("You can resubmit in 4s.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText("You can resubmit in 1s.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("You can send another request or message the host.")).toBeTruthy();

    expect(pageRenders).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("game page source", () => {
  const route = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");
  const banner = readFileSync("src/components/game-detail/GameApprovalBanner.tsx", "utf8");

  it("runs no interval of its own and leaves the countdown to the banner", () => {
    expect(route).not.toContain("setInterval(");
    expect(route).not.toContain("cooldownMs={");
    expect(banner).toContain("useResubmitCooldownMs(myReq)");
  });

  it("reads the cooldown when the player taps, not from the last render", () => {
    const gate = route.indexOf('if (myReq?.status === "rejected") {');
    expect(gate).toBeGreaterThan(0);
    const fresh = route.indexOf("const cooldownMs = joinResubmitCooldownRemainingMs(myReq);", gate);
    const toast = route.indexOf("before resubmitting.", gate);
    expect(fresh).toBeGreaterThan(gate);
    expect(fresh).toBeLessThan(toast);
  });
});
