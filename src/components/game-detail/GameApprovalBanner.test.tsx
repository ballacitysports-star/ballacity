// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Task #71: a guarded minor on an open game sees where they stand with their parent, not a host queue. */

vi.mock("@/components/LeaveFlowButton", () => ({ LeaveFlowButton: () => null }));
vi.mock("@/components/game-detail/GameDetailBits", () => ({ formatCooldownLabel: () => "" }));
vi.mock("@/lib/payments", () => ({ JOIN_RESUBMIT_MAX_ATTEMPTS: 3 }));

const { GameApprovalBanner } = await import("./GameApprovalBanner");
const { guardedOpenCopy } = await import("@/lib/guarded-open-join");
const { joinWait } = await import("@/lib/join-guardian-status");

afterEach(cleanup);

const base = {
  capReached: false,
  cooldownMs: 0,
  fee: 0,
  game: { id: "g1", title: "Run" } as never,
  isHost: false,
  isPaid: false,
  isPaymentVerified: false,
  myFlowStatus: "none" as never,
  myHoldLabel: null,
  myReq: null,
  myWait: null,
  refreshStatus: async () => {},
  requiresApproval: false,
};

describe("GameApprovalBanner on an open game", () => {
  it("asks a guarded minor to ask their parent", () => {
    render(
      <GameApprovalBanner
        {...base}
        guardedOpen={guardedOpenCopy("ask_parent", { isPaid: false })}
      />,
    );
    expect(screen.getByTestId("guarded-open-join").textContent).toMatch(/Ask your parent first/);
  });

  it("shows the parent-only wait without mentioning a host answer", () => {
    const myWait = joinWait({
      hostStatus: "pending",
      needsGuardian: true,
      guardianApproved: false,
      hostAnswers: false,
    });
    render(
      <GameApprovalBanner
        {...base}
        myWait={myWait}
        myReq={{ status: "pending" } as never}
        guardedOpen={guardedOpenCopy("ask_parent", { isPaid: false })}
      />,
    );
    const banner = screen.getByTestId("waiting-on-parent");
    expect(banner.textContent).toMatch(/Waiting for your parent/);
    expect(banner.textContent).not.toMatch(/and the host|host said yes/i);
    // The wait banner wins; the ask banner is not shown on top of it.
    expect(screen.queryByTestId("guarded-open-join")).toBeNull();
  });

  it("shows nothing extra to a host, or to anyone without the guarded path", () => {
    const { container } = render(
      <GameApprovalBanner
        {...base}
        isHost
        guardedOpen={guardedOpenCopy("ask_parent", { isPaid: false })}
      />,
    );
    expect(container.textContent).toBe("");
    render(<GameApprovalBanner {...base} />);
    expect(screen.queryByTestId("guarded-open-join")).toBeNull();
  });
});
