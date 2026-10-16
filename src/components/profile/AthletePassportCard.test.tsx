// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/players/PlayerPassportSection", () => ({
  PlayerPassportSection: ({ userId }: { userId: string }) => (
    <div data-testid="passport-data">{userId}</div>
  ),
}));

const { AthletePassportCard } = await import("./AthletePassportCard");

afterEach(cleanup);

const base = {
  userId: "u1",
  sports: [{ name: "Basketball" as const, positions: ["Point Guard"] }],
  city: "Austin, TX",
  age: 24,
  played: 12,
  reliability: 96,
  sportsmanship: 4.8,
  badgeCount: 3,
};

describe("AthletePassportCard", () => {
  it("shows sport, position, division, city and stats", () => {
    render(<AthletePassportCard {...base} />);
    expect(screen.getByText("Basketball")).toBeTruthy();
    expect(screen.getByText("Point Guard")).toBeTruthy();
    expect(screen.getByText("Adult · Austin, TX")).toBeTruthy();
    expect(screen.getByText("96%")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByTestId("passport-data").textContent).toBe("u1");
  });

  it("labels under-18 athletes as Youth without showing an exact age", () => {
    render(<AthletePassportCard {...base} age={15} />);
    expect(screen.getByText("Youth · Austin, TX")).toBeTruthy();
    expect(screen.queryByText(/15/)).toBeNull();
  });

  it("prompts to add sports when none are set", () => {
    render(<AthletePassportCard {...base} sports={[]} age={null} />);
    expect(screen.getByText(/Add your sports and positions/)).toBeTruthy();
    expect(screen.queryByLabelText("Sports")).toBeNull();
  });
});
