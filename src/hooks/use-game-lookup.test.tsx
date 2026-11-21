// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Game } from "@/lib/sample-data";

/**
 * Contract: the pay page's lookup by id runs once per game, settles, and stays
 * settled across re-renders. It used to restart on every render (it was keyed
 * on a list rebuilt each render), so a slow or empty answer never settled and
 * the page sat on "Loading… (lookup)" while firing request after request.
 */

vi.mock("@/lib/hosted-games-store", () => ({ fetchHostedGame: vi.fn() }));

const { useGameLookup } = await import("@/hooks/use-game-lookup");

const G2 = { id: "g2", title: "Sunday Sunset 7v7" } as Game;

afterEach(() => {
  vi.useRealTimers();
});

describe("useGameLookup", () => {
  it("does not look anything up when the game is already known", () => {
    const fetchGame = vi.fn();
    const { result } = renderHook(() => useGameLookup("g2", true, { fetchGame }));
    expect(result.current.lookupDone).toBe(true);
    expect(fetchGame).not.toHaveBeenCalled();
  });

  it("looks the game up once, however often the page re-renders", async () => {
    let resolve!: (g: Game | null) => void;
    const fetchGame = vi.fn(() => new Promise<Game | null>((r) => (resolve = r)));
    const { result, rerender } = renderHook(() => useGameLookup("g2", false, { fetchGame }));
    for (let i = 0; i < 20; i++) rerender();
    expect(fetchGame).toHaveBeenCalledTimes(1);
    expect(result.current.lookupDone).toBe(false);

    await act(async () => resolve(G2));
    expect(result.current).toEqual({ remoteGame: G2, lookupDone: true });
    for (let i = 0; i < 20; i++) rerender();
    expect(fetchGame).toHaveBeenCalledTimes(1);
    expect(result.current.lookupDone).toBe(true);
  });

  it("settles on 'not found' and does not start again", async () => {
    const fetchGame = vi.fn(async () => null);
    const { result, rerender } = renderHook(() => useGameLookup("nope", false, { fetchGame }));
    await act(async () => {});
    expect(result.current).toEqual({ remoteGame: null, lookupDone: true });
    for (let i = 0; i < 20; i++) rerender();
    await act(async () => {});
    expect(fetchGame).toHaveBeenCalledTimes(1);
    expect(result.current.lookupDone).toBe(true);
  });

  it("gives up after the timeout when the lookup hangs, and stays settled", async () => {
    vi.useFakeTimers();
    const fetchGame = vi.fn(() => new Promise<Game | null>(() => {}));
    const { result, rerender } = renderHook(() =>
      useGameLookup("g2", false, { fetchGame, timeoutMs: 8_000 }),
    );
    rerender();
    expect(result.current.lookupDone).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(result.current).toEqual({ remoteGame: null, lookupDone: true });
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchGame).toHaveBeenCalledTimes(1);
    expect(result.current.lookupDone).toBe(true);
  });

  it("treats a failed lookup as settled", async () => {
    const fetchGame = vi.fn(async () => {
      throw new Error("network");
    });
    const { result } = renderHook(() => useGameLookup("g2", false, { fetchGame }));
    await act(async () => {});
    expect(result.current).toEqual({ remoteGame: null, lookupDone: true });
  });

  it("looks again when the game changes, and ignores the old answer", async () => {
    const answers: Record<string, (g: Game | null) => void> = {};
    const fetchGame = vi.fn((id: string) => new Promise<Game | null>((r) => (answers[id] = r)));
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useGameLookup(id, false, { fetchGame }),
      { initialProps: { id: "g1" } },
    );
    rerender({ id: "g2" });
    expect(fetchGame.mock.calls.map((c) => c[0])).toEqual(["g1", "g2"]);
    await act(async () => answers.g1!({ id: "g1" } as Game));
    expect(result.current.lookupDone).toBe(false);
    await act(async () => answers.g2!(G2));
    expect(result.current).toEqual({ remoteGame: G2, lookupDone: true });
  });
});
