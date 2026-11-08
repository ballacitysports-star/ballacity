// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// The flow status must not go stale after the viewer leaves a game. Realtime
// cannot be relied on for that: without REPLICA IDENTITY FULL a DELETE event
// carries `new: {}` and only the primary key in `old`, so the event can't be
// matched to a game. Both paths are covered here: such an event reloads, and
// `refresh()` reloads on demand.
const rt = vi.hoisted(() => {
  type Handler = (p: { new?: unknown; old?: unknown }) => void;
  const handlers: Handler[] = [];
  const channel = () => {
    const c = {
      on: (_type: string, _filter: unknown, h: Handler) => {
        handlers.push(h);
        return c;
      },
      subscribe: () => c,
    };
    return c;
  };
  return { handlers, channel };
});

const reads = vi.hoisted(() => ({ joinRequest: 0 }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => chain,
      channel: rt.channel,
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/payments", () => ({
  getGamePaymentSettings: async () => null,
  getMyJoinRequest: async () => {
    reads.joinRequest += 1;
    return null;
  },
  listMySubmissionsForGame: async () => [],
}));

import { useMyFlowStatus } from "@/lib/game-flow-status";

const GAME = "host-mvli8ois-0sa6";

afterEach(() => {
  cleanup();
  rt.handlers.length = 0;
  reads.joinRequest = 0;
});

async function mounted() {
  const hook = renderHook(() => useMyFlowStatus(GAME));
  await waitFor(() => expect(reads.joinRequest).toBe(1));
  await waitFor(() => expect(rt.handlers.length).toBeGreaterThan(0));
  return hook;
}

describe("useMyFlowStatus reloads after a leave", () => {
  it("a DELETE event with only the primary key reloads", async () => {
    await mounted();
    act(() => rt.handlers[0]!({ new: {}, old: { id: "jr-1" } }));
    await waitFor(() => expect(reads.joinRequest).toBe(2));
  });

  it("an event for another game does not reload", async () => {
    await mounted();
    act(() => rt.handlers[0]!({ new: { id: "jr-2", game_id: "host-other-game" }, old: {} }));
    await new Promise((r) => setTimeout(r, 20));
    expect(reads.joinRequest).toBe(1);
  });

  it("refresh() reloads on demand", async () => {
    const { result } = await mounted();
    act(() => result.current.refresh());
    await waitFor(() => expect(reads.joinRequest).toBe(2));
  });
});
