// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { dateKeyInZone } from "@/lib/datetime";
import { HostGamesCalendar, gameFeeLabel, groupHostGames, type HostCalendarGame } from "./HostGamesCalendar";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const games: HostCalendarGame[] = [
  { id: "paid", title: "Paid run", date: "2026-10-15T16:00:00Z", price: 10, location: "Bogan Park", cancelled_at: null },
  { id: "free", title: "Free run", date: "2026-10-15T18:00:00Z", price: 0, location: null, cancelled_at: null },
  { id: "gone", title: "Rained out", date: "2026-10-15T20:00:00Z", price: 5, location: "Bogan Park", cancelled_at: "2026-10-14T00:00:00Z" },
];

describe("Host games calendar", () => {
  it("groups games on the viewer date and labels paid vs free fees", () => {
    const grouped = groupHostGames(games);
    expect(grouped.get(dateKeyInZone(games[0].date))).toHaveLength(3);
    expect(gameFeeLabel(10)).toBe("$10.00");
    expect(gameFeeLabel(0)).toBe("Free");
    expect(gameFeeLabel(null)).toBe("Free");
  });

  it("selects a day, shows its games with price and location, and navigates months", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    render(<HostGamesCalendar games={games} />);
    expect(screen.getByText("2 games")).toBeTruthy();
    expect(screen.getByText("1 paid · 1 free")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /2026-10-15, 3 games, includes paid/ }));
    expect(screen.getByText("Paid run")).toBeTruthy();
    expect(screen.getByText("Paid · $10.00")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getAllByText(/Bogan Park/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("November 2026")).toBeTruthy();
    expect(screen.getByText("No games scheduled this month.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("October 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: /2026-10-03, 0 games/ }).getAttribute("aria-pressed")).toBe("true");
  });
});
