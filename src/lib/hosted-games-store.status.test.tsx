// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  fetches: 0,
  result: { data: null as unknown, error: { message: "offline" } as unknown },
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    is: () => query,
    order: () => {
      h.fetches += 1;
      return Promise.resolve(h.result);
    },
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: () => query,
      channel: () => channel,
      removeChannel: () => undefined,
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});

async function load() {
  vi.resetModules();
  return import("./hosted-games-store");
}

beforeEach(() => {
  h.fetches = 0;
  h.result = { data: null, error: { message: "offline" } };
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("hosted games load status", () => {
  it("starts as loading, then reports a failed first load instead of staying silent", async () => {
    const store = await load();
    const { result } = renderHook(() => ({
      status: store.useHostedGamesStatus(),
      games: store.useHostedGames(),
    }));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.games).toEqual([]);
  });

  it("does not hammer the server while it is failing: reporting the failure re-reads the store", async () => {
    const store = await load();
    const { result, rerender } = renderHook(() => ({
      status: store.useHostedGamesStatus(),
      games: store.useHostedGames(),
    }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    for (let i = 0; i < 5; i++) rerender();
    expect(h.fetches).toBe(1);
  });

  it("Try again goes back to loading, fetches again, and reports ready on success", async () => {
    const store = await load();
    const { result } = renderHook(() => ({
      status: store.useHostedGamesStatus(),
      games: store.useHostedGames(),
    }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    h.result = { data: [], error: null };
    act(() => store.retryHostedGames());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(h.fetches).toBe(2);
  });

  it("retries by itself once the pause has passed", async () => {
    const store = await load();
    const { result, rerender } = renderHook(() => ({
      status: store.useHostedGamesStatus(),
      games: store.useHostedGames(),
    }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    h.result = { data: [], error: null };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16_000);
    rerender();
    vi.useRealTimers();
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
