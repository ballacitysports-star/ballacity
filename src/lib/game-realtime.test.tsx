// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * Contract: the game details view subscribes to four realtime channels
 * keyed on (gameId, userId, hostsThisGame). Switching game OR user MUST
 * tear down the old channels and re-subscribe with the new ids, or the
 * viewer keeps receiving events for the previous game/account.
 *
 * These tests stub the Supabase client to record every channel/removeChannel
 * call and assert exact channel names and lifecycle transitions.
 */

type Recorded = {
  subscribed: string[];
  removed: string[];
  activeNames: () => string[];
};

const recorded: Recorded = {
  subscribed: [],
  removed: [],
  activeNames() {
    const active: string[] = [];
    const removedCopy = [...recorded.removed];
    for (const name of recorded.subscribed) {
      const idx = removedCopy.indexOf(name);
      if (idx >= 0) removedCopy.splice(idx, 1);
      else active.push(name);
    }
    return active;
  },
};

vi.mock("@/integrations/supabase/client", () => {
  const makeChannel = (name: string) => {
    const ch: any = {
      _name: name,
      on: () => ch,
      subscribe: () => ch,
    };
    return ch;
  };
  return {
    supabase: {
      channel: (name: string) => {
        recorded.subscribed.push(name);
        return makeChannel(name);
      },
      removeChannel: (ch: { _name: string }) => {
        recorded.removed.push(ch._name);
      },
    },
  };
});

// Import AFTER vi.mock so the hook picks up the stubbed client.
import { useGameRealtimeChannels } from "./game-realtime";

const noop = () => {};
const defaultCallbacks = {
  onHostJoinRequestChange: noop,
  onMyJoinRequestChange: noop,
  onSettingsChange: noop,
  onMyPaymentChange: noop,
};

beforeEach(() => {
  recorded.subscribed = [];
  recorded.removed = [];
});

describe("useGameRealtimeChannels — channel key contract", () => {
  it("subscribes to all four channels for a host with matching gameId + userId", () => {
    renderHook(() =>
      useGameRealtimeChannels({
        gameId: "g1",
        userId: "u1",
        hostsThisGame: true,
        ...defaultCallbacks,
      }),
    );
    expect(recorded.activeNames().sort()).toEqual(
      [
        "join_requests:host:g1:u1",
        "join_requests:me:g1:u1",
        "game_payment_settings:g1",
        "payment_submissions:me:g1:u1",
      ].sort(),
    );
    expect(recorded.removed).toEqual([]);
  });

  it("skips the host channel when the viewer does not host", () => {
    renderHook(() =>
      useGameRealtimeChannels({
        gameId: "g1",
        userId: "u1",
        hostsThisGame: false,
        ...defaultCallbacks,
      }),
    );
    expect(recorded.activeNames().sort()).toEqual(
      ["join_requests:me:g1:u1", "game_payment_settings:g1", "payment_submissions:me:g1:u1"].sort(),
    );
    expect(recorded.subscribed).not.toContain("join_requests:host:g1:u1");
  });
});

describe("useGameRealtimeChannels — resubscribes on identity change", () => {
  it("tears down every g1 channel and resubscribes as g2 when the viewed game changes", () => {
    const { rerender } = renderHook(
      (props: { gameId: string; userId: string; hostsThisGame: boolean }) =>
        useGameRealtimeChannels({ ...props, ...defaultCallbacks }),
      { initialProps: { gameId: "g1", userId: "u1", hostsThisGame: true } },
    );

    // Baseline: four g1 channels active.
    expect(recorded.activeNames().length).toBe(4);

    rerender({ gameId: "g2", userId: "u1", hostsThisGame: true });

    // Every g1 channel was removed.
    for (const name of [
      "join_requests:host:g1:u1",
      "join_requests:me:g1:u1",
      "game_payment_settings:g1",
      "payment_submissions:me:g1:u1",
    ]) {
      expect(recorded.removed).toContain(name);
    }
    // And every g2 channel was subscribed.
    expect(recorded.activeNames().sort()).toEqual(
      [
        "join_requests:host:g2:u1",
        "join_requests:me:g2:u1",
        "game_payment_settings:g2",
        "payment_submissions:me:g2:u1",
      ].sort(),
    );
  });

  it("tears down the three user-scoped channels and resubscribes as u2 when the viewer switches accounts; the game-scoped settings channel stays", () => {
    const { rerender } = renderHook(
      (props: { gameId: string; userId: string; hostsThisGame: boolean }) =>
        useGameRealtimeChannels({ ...props, ...defaultCallbacks }),
      { initialProps: { gameId: "g1", userId: "u1", hostsThisGame: true } },
    );

    rerender({ gameId: "g1", userId: "u2", hostsThisGame: true });

    // User-scoped channels for u1 were torn down.
    for (const name of [
      "join_requests:host:g1:u1",
      "join_requests:me:g1:u1",
      "payment_submissions:me:g1:u1",
    ]) {
      expect(recorded.removed).toContain(name);
    }
    // Settings channel is keyed only on gameId — must NOT churn.
    expect(recorded.removed).not.toContain("game_payment_settings:g1");

    // User-scoped channels for u2 were opened.
    expect(recorded.activeNames().sort()).toEqual(
      [
        "join_requests:host:g1:u2",
        "join_requests:me:g1:u2",
        "game_payment_settings:g1",
        "payment_submissions:me:g1:u2",
      ].sort(),
    );
  });

  it("adds the host channel without touching the others when hostsThisGame flips false → true", () => {
    const { rerender } = renderHook(
      (props: { gameId: string; userId: string; hostsThisGame: boolean }) =>
        useGameRealtimeChannels({ ...props, ...defaultCallbacks }),
      { initialProps: { gameId: "g1", userId: "u1", hostsThisGame: false } },
    );

    const beforeSubs = [...recorded.subscribed];
    const beforeRemoves = [...recorded.removed];

    rerender({ gameId: "g1", userId: "u1", hostsThisGame: true });

    // Only the host channel is newly subscribed.
    const newlySubscribed = recorded.subscribed.slice(beforeSubs.length);
    expect(newlySubscribed).toEqual(["join_requests:host:g1:u1"]);
    // Nothing was removed as part of this transition.
    expect(recorded.removed).toEqual(beforeRemoves);
  });
});

describe("useGameRealtimeChannels — no leaks", () => {
  it("removes every active channel on unmount", () => {
    const { unmount } = renderHook(() =>
      useGameRealtimeChannels({
        gameId: "g1",
        userId: "u1",
        hostsThisGame: true,
        ...defaultCallbacks,
      }),
    );
    expect(recorded.activeNames().length).toBe(4);
    unmount();
    expect(recorded.activeNames()).toEqual([]);
  });

  it("keeps subscribed − removed equal to the currently-active channel count across a game switch and then unmount", () => {
    const { rerender, unmount } = renderHook(
      (props: { gameId: string; userId: string; hostsThisGame: boolean }) =>
        useGameRealtimeChannels({ ...props, ...defaultCallbacks }),
      { initialProps: { gameId: "g1", userId: "u1", hostsThisGame: true } },
    );
    expect(recorded.subscribed.length - recorded.removed.length).toBe(4);
    rerender({ gameId: "g2", userId: "u1", hostsThisGame: true });
    expect(recorded.subscribed.length - recorded.removed.length).toBe(4);
    unmount();
    expect(recorded.subscribed.length - recorded.removed.length).toBe(0);
  });

  it("does not subscribe when gameId is missing", () => {
    renderHook(() =>
      useGameRealtimeChannels({
        gameId: undefined,
        userId: "u1",
        hostsThisGame: true,
        ...defaultCallbacks,
      }),
    );
    expect(recorded.subscribed).toEqual([]);
  });

  it("does not subscribe user-scoped channels when userId is missing (settings still opens)", () => {
    renderHook(() =>
      useGameRealtimeChannels({
        gameId: "g1",
        userId: undefined,
        hostsThisGame: true,
        ...defaultCallbacks,
      }),
    );
    expect(recorded.activeNames()).toEqual(["game_payment_settings:g1"]);
  });
});
