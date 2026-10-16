// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EventAvailabilitySummary, availabilityRoster } from "./EventAvailabilitySummary";

afterEach(cleanup);

const members = [
  { userId: "coach", name: "Coach Kim", role: "coach" },
  { userId: "p1", name: "Ava", role: "player" },
  { userId: "p2", name: "Ben", role: "captain" },
  { userId: "p3", name: "Cal", role: "player" },
];

describe("Event availability summary", () => {
  it("leaves out staff unless they answered", () => {
    expect(availabilityRoster(members, []).map((m) => m.userId)).toEqual(["p1", "p2", "p3"]);
    expect(availabilityRoster(members, [{ userId: "coach", status: "available", note: null, byGuardian: false }])).toHaveLength(4);
  });

  it("summarizes the roster and expands to per-player answers", () => {
    render(<EventAvailabilitySummary members={members} answers={[
      { userId: "p1", status: "available", note: null, byGuardian: true },
      { userId: "p2", status: "unavailable", note: "Out of town", byGuardian: false },
    ]} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.textContent).toContain("1 available · 0 maybe · 1 out · 1 no reply");
    fireEvent.click(toggle);
    expect(screen.getByText("Available (guardian)")).toBeTruthy();
    expect(screen.getByText("Can't make it · Out of town")).toBeTruthy();
    expect(screen.getByText("No reply")).toBeTruthy();
  });
});
