// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

/**
 * useReelRealtime loads nothing itself: each caller loads on mount and reloads in onChange. That
 * load may have been answered before the changes were live, so the hook opens its channel with
 * wait and runs onChange (through its debounce) on every SUBSCRIBED.
 */

const h = vi.hoisted(() => ({
  opened: [] as Array<{ name: string; options: unknown }>,
  status: undefined as undefined | ((status: string) => void),
  change: undefined as undefined | (() => void),
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: (_type: string, _filter: unknown, cb: () => void) => {
      h.change = cb;
      return channel;
    },
    subscribe: (cb?: (status: string) => void) => {
      h.status = cb;
      return channel;
    },
  };
  return {
    supabase: {
      channel: (name: string, options?: unknown) => {
        h.opened.push({ name, options });
        return channel;
      },
      removeChannel: async () => "ok",
    },
  };
});

import { useReelRealtime } from "./use-reel-realtime";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  h.opened = [];
  h.status = undefined;
  h.change = undefined;
});

describe("useReelRealtime", () => {
  it("opens its channel holding SUBSCRIBED until the changes are live, topic unchanged", () => {
    renderHook(() => useReelRealtime(() => {}, { userId: "u1" }));
    expect(h.opened).toHaveLength(1);
    expect(h.opened[0].name).toMatch(/^reel-realtime-u1-[a-z0-9]+$/);
    expect(h.opened[0].options).toStrictEqual({
      config: { postgres_changes_options: { wait: true } },
    });
  });

  it("runs onChange on every SUBSCRIBED, the first included, after the debounce", () => {
    const onChange = vi.fn();
    renderHook(() => useReelRealtime(onChange));

    act(() => h.status?.("SUBSCRIBED"));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => h.status?.("CHANNEL_ERROR"));
    act(() => vi.advanceTimersByTime(400));
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => h.status?.("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(400));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("folds a SUBSCRIBED and a change that arrive together into one onChange", () => {
    const onChange = vi.fn();
    renderHook(() => useReelRealtime(onChange));

    act(() => h.status?.("SUBSCRIBED"));
    act(() => h.change?.());
    act(() => vi.advanceTimersByTime(400));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("opens no channel while disabled", () => {
    renderHook(() => useReelRealtime(() => {}, { enabled: false }));
    expect(h.opened).toStrictEqual([]);
  });
});
