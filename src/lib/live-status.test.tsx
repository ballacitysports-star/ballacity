// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useJoinGate, useLiveStatus } from "@/lib/live-status";
import type { Game } from "@/lib/sample-data";

/**
 * Regression: the game details view rebuilds its `game` object on every
 * render. When these hooks keyed their effect on the object identity, the
 * setState inside the effect re-ran forever and React threw
 * "Maximum update depth exceeded", which replaced the whole game page
 * (and its Request-to-join CTA) with the router error screen.
 *
 * These tests re-render with a *fresh* game object each time and assert the
 * returned value stays referentially stable.
 */

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "g-test",
    date: new Date(Date.now() + 3 * 3600_000).toISOString(),
    duration: "90 min",
    joinsClosed: false,
    ...overrides,
  } as unknown as Game;
}

describe("useJoinGate / useLiveStatus stability", () => {
  it("keeps the same gate object across re-renders with a new game object", () => {
    const { result, rerender } = renderHook(
      ({ spotsLeft }: { spotsLeft: number }) => useJoinGate(makeGame(), { spotsLeft }),
      { initialProps: { spotsLeft: 4 } },
    );
    const first = result.current;
    expect(first.joinState).toBe("open");
    for (let i = 0; i < 5; i++) rerender({ spotsLeft: 4 });
    expect(result.current).toBe(first);
  });

  it("still recomputes when a gate-relevant input changes", () => {
    const { result, rerender } = renderHook(
      ({ spotsLeft }: { spotsLeft: number }) => useJoinGate(makeGame(), { spotsLeft }),
      { initialProps: { spotsLeft: 4 } },
    );
    expect(result.current.locked).toBe(false);
    rerender({ spotsLeft: 0 });
    expect(result.current.joinState).toBe("roster_full");
    expect(result.current.locked).toBe(true);
  });

  it("accepts a game that hasn't loaded yet, then resolves it once it arrives", () => {
    // The game page calls this before its loading / not-found returns, so the
    // first render of a deep link passes `undefined`.
    const { result, rerender } = renderHook(
      ({ game }: { game: Game | undefined }) => useJoinGate(game, { spotsLeft: 0 }),
      { initialProps: { game: undefined as Game | undefined } },
    );
    expect(result.current.locked).toBe(false);
    rerender({ game: makeGame() });
    expect(result.current.joinState).toBe("roster_full");
    expect(result.current.locked).toBe(true);
  });

  it("keeps live status stable across re-renders with a new game object", () => {
    const { result, rerender } = renderHook(() => useLiveStatus(makeGame()));
    expect(result.current).toBe("scheduled");
    for (let i = 0; i < 5; i++) rerender();
    expect(result.current).toBe("scheduled");
  });
});
