// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  player: undefined as unknown,
  host: null as unknown,
  playerArg: undefined as unknown,
  hostArg: undefined as unknown,
}));

vi.mock("@/lib/player-stats", async () => {
  const actual = await vi.importActual<typeof import("@/lib/player-stats")>("@/lib/player-stats");
  return {
    ...actual,
    usePlayerActivityStats: (id: string | undefined) => {
      h.playerArg = id;
      return { data: id ? h.player : undefined };
    },
  };
});
vi.mock("@/lib/game-lifecycle", () => ({
  useHostAttendanceStats: (id: string | undefined) => {
    h.hostArg = id;
    return id ? h.host : null;
  },
}));

import { MeasuredStats } from "./MeasuredStats";
import { EMPTY_PLAYER_STATS } from "@/lib/player-stats";

const UUID = "00000000-0000-4000-8000-00000000000b";

afterEach(() => {
  cleanup();
  h.player = undefined;
  h.host = null;
  h.playerArg = h.hostArg = undefined;
});

describe("MeasuredStats", () => {
  it("shows nothing for demo ids and doesn't even query for them", () => {
    h.player = { ...EMPTY_PLAYER_STATS, gamesAttended: 9 };
    const { container } = render(<MeasuredStats revieweeId="c-jordan-kim" kind="player" />);
    expect(container.innerHTML).toBe("");
    expect(h.playerArg).toBeUndefined();
  });

  it("does not claim a perfect record for a player with nothing marked yet", () => {
    h.player = { ...EMPTY_PLAYER_STATS, gamesJoined: 3 };
    const { container } = render(<MeasuredStats revieweeId={UUID} kind="player" />);
    expect(container.innerHTML).toBe("");
  });

  it("reports show-up rate and games played for a player with marked games", () => {
    h.player = { ...EMPTY_PLAYER_STATS, gamesAttended: 9, noShows: 1 };
    render(<MeasuredStats revieweeId={UUID} kind="player" />);
    expect(screen.getByTestId("measured-stats").textContent).toContain(
      "Shows up 90% of the time · 9 games played",
    );
  });

  it("uses the singular for one game and mentions hosting", () => {
    h.player = { ...EMPTY_PLAYER_STATS, gamesAttended: 1, hostedCompleted: 2 };
    render(<MeasuredStats revieweeId={UUID} kind="player" />);
    const text = screen.getByTestId("measured-stats").textContent ?? "";
    expect(text).toContain("Shows up 100% of the time · 1 game played");
    expect(text).toContain("Has hosted 2 games");
  });

  it("reports a host's games run and cancellations", () => {
    h.host = { marked: 4, attended: 4, cancelledGames: 1, completedGames: 7, attendanceRate: 1 };
    render(<MeasuredStats revieweeId={UUID} kind="host" />);
    expect(screen.getByTestId("measured-stats").textContent).toContain("Ran 7 games · cancelled 1");
    expect(h.playerArg).toBeUndefined();
  });

  it("says none were cancelled when that's true, and stays hidden for a brand-new host", () => {
    h.host = { marked: 0, attended: 0, cancelledGames: 0, completedGames: 3, attendanceRate: null };
    const first = render(<MeasuredStats revieweeId={UUID} kind="host" />);
    expect(screen.getByTestId("measured-stats").textContent).toContain(
      "Ran 3 games · none cancelled",
    );
    first.unmount();
    h.host = { marked: 0, attended: 0, cancelledGames: 0, completedGames: 0, attendanceRate: null };
    const second = render(<MeasuredStats revieweeId={UUID} kind="host" />);
    expect(second.container.innerHTML).toBe("");
  });

  it("measures nothing for trainers or teams", () => {
    h.player = { ...EMPTY_PLAYER_STATS, gamesAttended: 9 };
    const { container } = render(<MeasuredStats revieweeId={UUID} kind="team" />);
    expect(container.innerHTML).toBe("");
    expect(h.playerArg).toBeUndefined();
    expect(h.hostArg).toBeUndefined();
  });
});
