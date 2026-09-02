import { describe, it, expect } from "vitest";
import {
  resolveGameStatus,
  isGameCancelled,
  isGameCompleted,
  joinGateErrorMessage,
} from "@/lib/game-status";
import { isGameFinished } from "@/lib/game-time";

const NOW = new Date("2026-06-01T12:00:00Z").getTime();
const base = {
  date: new Date(NOW + 6 * 60 * 60 * 1000).toISOString(),
  duration: "90 min",
};

describe("resolveGameStatus", () => {
  it("reports an upcoming game with spots as open", () => {
    const r = resolveGameStatus(base, { spotsLeft: 4, now: NOW });
    expect(r.status).toBe("open");
    expect(r.joinBlocked).toBe(false);
    expect(r.terminal).toBe(false);
  });

  it("flags games starting within the hour", () => {
    const r = resolveGameStatus(
      { ...base, date: new Date(NOW + 30 * 60 * 1000).toISOString() },
      { spotsLeft: 2, now: NOW },
    );
    expect(r.status).toBe("starting_soon");
    expect(r.joinBlocked).toBe(false);
  });

  it("blocks joins when the roster is full", () => {
    const r = resolveGameStatus(base, { spotsLeft: 0, now: NOW });
    expect(r.status).toBe("full");
    expect(r.joinBlocked).toBe(true);
    expect(r.terminal).toBe(false);
  });

  it("blocks joins when the host closed signups", () => {
    const r = resolveGameStatus({ ...base, joinsClosed: true }, { spotsLeft: 5, now: NOW });
    expect(r.status).toBe("closed");
    expect(r.joinBlocked).toBe(true);
  });

  it("respects the signup cutoff", () => {
    const r = resolveGameStatus(
      { ...base, date: new Date(NOW + 20 * 60 * 1000).toISOString(), signupCutoffMin: 30 },
      { spotsLeft: 5, now: NOW },
    );
    expect(r.status).toBe("closed");
  });

  it("marks in-progress games", () => {
    const r = resolveGameStatus(
      { ...base, date: new Date(NOW - 10 * 60 * 1000).toISOString() },
      { spotsLeft: 5, now: NOW },
    );
    expect(r.status).toBe("in_progress");
    expect(r.joinBlocked).toBe(true);
  });

  it("marks games past their end as completed", () => {
    const r = resolveGameStatus(
      { ...base, date: new Date(NOW - 5 * 60 * 60 * 1000).toISOString() },
      { now: NOW },
    );
    expect(r.status).toBe("completed");
    expect(r.terminal).toBe(true);
  });

  it("cancellation outranks the clock, the roster and the cutoff", () => {
    const r = resolveGameStatus(
      {
        ...base,
        cancelledAt: new Date(NOW).toISOString(),
        cancellationReason: "Field flooded",
        joinsClosed: false,
      },
      { spotsLeft: 8, now: NOW },
    );
    expect(r.status).toBe("cancelled");
    expect(r.detail).toContain("Field flooded");
    expect(r.joinBlocked).toBe(true);
    expect(r.terminal).toBe(true);
  });

  it("treats an explicit completed_at as completed even before the end time", () => {
    const game = { ...base, completedAt: new Date(NOW).toISOString() };
    expect(isGameCompleted(game, NOW)).toBe(true);
    expect(resolveGameStatus(game, { now: NOW }).status).toBe("completed");
  });

  it("never reads a cancelled game as completed", () => {
    const game = { ...base, cancelledAt: new Date(NOW).toISOString(), completedAt: null };
    expect(isGameCancelled(game)).toBe(true);
    expect(isGameCompleted(game, NOW)).toBe(false);
  });
});

describe("discovery lists", () => {
  it("hides cancelled and completed games even when their start is in the future", () => {
    expect(isGameFinished({ ...base, status: "cancelled" }, NOW)).toBe(true);
    expect(isGameFinished({ ...base, completedAt: new Date(NOW).toISOString() }, NOW)).toBe(true);
    expect(isGameFinished(base, NOW)).toBe(false);
  });
});

describe("joinGateErrorMessage", () => {
  it("translates every server gate code into a player-facing sentence", () => {
    expect(joinGateErrorMessage({ message: "GAME_CANCELLED: ..." })).toMatch(/cancelled/i);
    expect(joinGateErrorMessage({ message: "GAME_COMPLETED: ..." })).toMatch(/ended/i);
    expect(joinGateErrorMessage({ message: "GAME_JOINS_CLOSED: ..." })).toMatch(/closed joining/i);
    expect(joinGateErrorMessage({ message: "GAME_SIGNUP_CLOSED: ..." })).toMatch(/closed/i);
    expect(joinGateErrorMessage({ message: "GAME_FULL: ..." })).toMatch(/waitlist/i);
    expect(joinGateErrorMessage({ message: "boom" })).toMatch(/Couldn't join/i);
  });
});
