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

type StatusHandler = (status: string, err?: Error) => void;

type Recorded = {
  subscribed: string[];
  removed: string[];
  // The options each channel was opened with, and the status handler passed to its subscribe, by name.
  options: Record<string, unknown>;
  statusHandlers: Record<string, StatusHandler | undefined>;
  activeNames: () => string[];
};

const recorded: Recorded = {
  subscribed: [],
  removed: [],
  options: {},
  statusHandlers: {},
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
      subscribe: (cb?: StatusHandler) => {
        recorded.statusHandlers[name] = cb;
        return ch;
      },
    };
    return ch;
  };
  return {
    supabase: {
      channel: (name: string, options?: unknown) => {
        recorded.subscribed.push(name);
        recorded.options[name] = options;
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
  recorded.options = {};
  recorded.statusHandlers = {};
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

describe("useGameRealtimeChannels: catch-up once changes are live", () => {
  const channels = [
    ["join_requests:host:g1:u1", "onHostJoinRequestChange"],
    ["join_requests:me:g1:u1", "onMyJoinRequestChange"],
    ["game_payment_settings:g1", "onSettingsChange"],
    ["payment_submissions:me:g1:u1", "onMyPaymentChange"],
  ] as const;

  const mountWithSpies = () => {
    const spies = {
      onHostJoinRequestChange: vi.fn(),
      onMyJoinRequestChange: vi.fn(),
      onSettingsChange: vi.fn(),
      onMyPaymentChange: vi.fn(),
    };
    const view = renderHook(
      (cbs: typeof spies) =>
        useGameRealtimeChannels({ gameId: "g1", userId: "u1", hostsThisGame: true, ...cbs }),
      { initialProps: spies },
    );
    return { spies, view };
  };

  it("opens every channel holding SUBSCRIBED until the server streams the changes", () => {
    mountWithSpies();
    // Every table here is in the supabase_realtime publication, so a join that waits is accepted.
    for (const [name] of channels) {
      expect(recorded.options[name]).toStrictEqual({
        config: { postgres_changes_options: { wait: true } },
      });
    }
  });

  it.each(channels)(
    "%s re-reads through %s on every SUBSCRIBED, and only that channel's callback",
    (name, cb) => {
      const { spies } = mountWithSpies();
      const handler = recorded.statusHandlers[name];
      expect(handler).toBeTypeOf("function");
      handler!("SUBSCRIBED");
      expect(spies[cb]).toHaveBeenCalledTimes(1);
      for (const [, other] of channels) {
        if (other !== cb) expect(spies[other]).not.toHaveBeenCalled();
      }
      // A rejoin after a drop is another SUBSCRIBED: changes made while down are not replayed.
      handler!("SUBSCRIBED");
      expect(spies[cb]).toHaveBeenCalledTimes(2);
    },
  );

  it("still warns on other statuses, without re-reading", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { spies } = mountWithSpies();
      for (const [name] of channels) recorded.statusHandlers[name]!("CHANNEL_ERROR");
      expect(warn).toHaveBeenCalledTimes(4);
      expect(warn).toHaveBeenCalledWith(
        "[realtime] join_requests:host channel status: CHANNEL_ERROR",
      );
      for (const [, cb] of channels) expect(spies[cb]).not.toHaveBeenCalled();
      // SUBSCRIBED is not warned about.
      recorded.statusHandlers["game_payment_settings:g1"]!("SUBSCRIBED");
      expect(warn).toHaveBeenCalledTimes(4);
    } finally {
      warn.mockRestore();
    }
  });

  it("calls the caller's latest callback, not the one from the first render", () => {
    const { spies, view } = mountWithSpies();
    const later = { ...spies, onSettingsChange: vi.fn() };
    view.rerender(later);
    recorded.statusHandlers["game_payment_settings:g1"]!("SUBSCRIBED");
    expect(later.onSettingsChange).toHaveBeenCalledTimes(1);
    expect(spies.onSettingsChange).not.toHaveBeenCalled();
  });
});
