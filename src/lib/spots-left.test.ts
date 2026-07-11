import { describe, it, expect } from "vitest";
import { computeSpotsLeft } from "./spots-left";

/**
 * Unit tests for the Discover bottom card's spots-left calculation.
 *
 * The card renders on mount before `useLiveParticipantCount` has hydrated
 * (it returns `undefined` until the first `select count(*)` completes).
 * During that window the pill MUST fall back to `game.joined`. Once the
 * live count arrives, it replaces the snapshot for every subsequent render.
 */
describe("computeSpotsLeft", () => {
  it("falls back to game.joined when the live count has not hydrated yet", () => {
    // 10-player game, snapshot says 4 joined, realtime hydration pending.
    expect(computeSpotsLeft(10, 4, undefined)).toBe(6);
  });

  it("uses the live count once the first realtime update arrives", () => {
    // Same snapshot as above, but realtime now reports 7 participants.
    // The pill must reflect the live number, not the stale snapshot.
    expect(computeSpotsLeft(10, 4, 7)).toBe(3);
  });

  it("prefers a live count of 0 over the snapshot (0 is not 'unhydrated')", () => {
    // Snapshot said 3 joined but the roster has been fully cleared.
    // `0` is a real value — only `undefined` should trigger fallback.
    expect(computeSpotsLeft(10, 3, 0)).toBe(10);
  });

  it("clamps to zero when the live count meets or exceeds capacity", () => {
    expect(computeSpotsLeft(10, 4, 10)).toBe(0);
    expect(computeSpotsLeft(10, 4, 12)).toBe(0);
  });

  it("clamps to zero when the fallback snapshot already exceeds capacity", () => {
    // Host lowered maxPlayers after the snapshot was taken; still no live
    // data yet. The pill must not go negative.
    expect(computeSpotsLeft(5, 8, undefined)).toBe(0);
  });

  it("returns full capacity when nobody has joined and hydration is pending", () => {
    expect(computeSpotsLeft(10, 0, undefined)).toBe(10);
  });
});
