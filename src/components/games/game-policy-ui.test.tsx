// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

import { GamePolicyFields } from "./GamePolicyFields";
import { GamePolicySummary } from "./GamePolicySummary";
import { HostTrustPanel } from "./HostTrustPanel";
import { defaultGamePolicy, normalizeGamePolicy } from "@/lib/game-policy";

describe("game policy UI", () => {
  it("edits player limits and waitlist through the shared editor", () => {
    const onChange = vi.fn();
    render(
      <GamePolicyFields value={defaultGamePolicy(10)} onChange={onChange} idPrefix="t" />,
    );
    fireEvent.change(screen.getByLabelText("Player limit"), { target: { value: "14" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ maxPlayers: 14 }));

    onChange.mockClear();
    fireEvent.click(screen.getByText("Waitlist when full"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ allowWaitlist: false }));
  });

  it("shows critical payment and cancellation info to players without expanding", () => {
    render(
      <GamePolicySummary
        policy={normalizeGamePolicy({ entryFee: 15, requiresApproval: true, gameRules: "First to 21." })}
      />,
    );
    expect(screen.getByText(/paid directly to the host/i)).toBeTruthy();
    expect(screen.getByText(/approves each request/i)).toBeTruthy();
  });

  it("never renders a verification badge without a real verification", () => {
    const { rerender } = render(
      <HostTrustPanel
        trust={{
          gamesHosted: 3,
          rating: null,
          reviewCount: 0,
          attendanceRate: null,
          verified: false,
          verifiedLabel: null,
        }}
        hostName="Sam"
      />,
    );
    expect(screen.queryByText(/^Verified/)).toBeNull();

    rerender(
      <HostTrustPanel
        trust={{
          gamesHosted: 3,
          rating: 4.6,
          reviewCount: 8,
          attendanceRate: null,
          verified: true,
          verifiedLabel: "Verified team profile",
        }}
        hostName="Sam"
      />,
    );
    expect(screen.getByText("Verified team profile")).toBeTruthy();
  });
});
