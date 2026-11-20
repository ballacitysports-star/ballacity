// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
vi.mock("@tanstack/react-router", () => ({
  Link: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

import { GamePolicyFields } from "./GamePolicyFields";
import { GamePolicySummary } from "./GamePolicySummary";
import { HostTrustPanel } from "./HostTrustPanel";
import { defaultGamePolicy, normalizeGamePolicy } from "@/lib/game-policy";

describe("game policy UI", () => {
  it("edits player limits and waitlist through the shared editor", () => {
    const onChange = vi.fn();
    render(<GamePolicyFields value={defaultGamePolicy(10)} onChange={onChange} idPrefix="t" />);
    fireEvent.change(screen.getByLabelText("Player limit"), { target: { value: "14" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ maxPlayers: 14 }));

    onChange.mockClear();
    fireEvent.click(screen.getByText("Waitlist when full"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ allowWaitlist: false }));
  });

  it("points a free game's fee hint at the Paid game switch, not a hidden field", () => {
    const { container } = render(
      <GamePolicyFields value={defaultGamePolicy(10)} onChange={() => {}} idPrefix="fee" />,
    );
    expect(within(container).getByText(/turn on Paid game under Details/i)).toBeTruthy();
    expect(within(container).queryByText(/in the fee field/i)).toBeNull();
  });

  it("can leave the player limit to the create form's Spots and show problems inline", () => {
    const { container } = render(
      <GamePolicyFields
        value={{
          ...defaultGamePolicy(10),
          minPlayers: 12,
          cancellationPolicy: "custom",
          cancellationNotes: "",
        }}
        onChange={() => {}}
        idPrefix="c"
        showPlayerLimit={false}
        errors={{ cancellationNotes: "Describe your custom cancellation terms." }}
      />,
    );
    const view = within(container);
    expect(view.queryByLabelText("Player limit")).toBeNull();
    const min = view.getByLabelText("Minimum to play");
    expect(min.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(min.getAttribute("aria-describedby")!)?.textContent).toMatch(
      /more than the spots/,
    );
    const notes = view.getByLabelText("Cancellation notes");
    expect(notes.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(notes.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Describe your custom cancellation terms.",
    );
  });

  it("ties the cancellation preset to the cutoff that refunds use", () => {
    const onChange = vi.fn();
    const { container } = render(
      <GamePolicyFields
        value={normalizeGamePolicy({ entryFee: 10, cancelCutoffMin: 120 })}
        onChange={onChange}
        idPrefix="cutoff-test"
      />,
    );
    // The refund preview reflects the real cutoff (2 hours), and it is editable.
    expect(within(container).getByText(/more than 2 hours before start/i)).toBeTruthy();
    fireEvent.click(within(container).getByRole("button", { name: /Standard.*24h/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ cancellationPolicy: "standard", cancelCutoffMin: 1440 }),
    );
    onChange.mockClear();
    fireEvent.change(within(container).getByLabelText(/Cancellation cutoff/), {
      target: { value: "720" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cancelCutoffMin: 720 }));
  });

  it("shows critical payment and cancellation info to players without expanding", () => {
    render(
      <GamePolicySummary
        policy={normalizeGamePolicy({
          entryFee: 15,
          requiresApproval: true,
          gameRules: "First to 21.",
        })}
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
