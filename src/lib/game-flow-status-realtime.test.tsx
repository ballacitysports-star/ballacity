// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// A stand-in for the realtime client that behaves like the real one: asking for a topic that is
// already in use returns the existing channel, and adding a postgres_changes listener to a
// channel that has been subscribed throws.
const realtime = vi.hoisted(() => {
  type Chan = { topic: string; subscribed: boolean; on: unknown; subscribe: unknown };
  const channels = new Map<string, Chan>();
  const topics: string[] = [];
  const channel = (topic: string): Chan => {
    topics.push(topic);
    const existing = channels.get(topic);
    if (existing) return existing;
    const c: Chan = { topic, subscribed: false, on: null, subscribe: null };
    c.on = (type: string) => {
      if (c.subscribed && type === "postgres_changes") {
        throw new Error(
          `cannot add \`${type}\` callbacks for realtime:${topic} after \`subscribe()\`.`,
        );
      }
      return c;
    };
    c.subscribe = () => {
      c.subscribed = true;
      return c;
    };
    channels.set(topic, c);
    return c;
  };
  return { channels, topics, channel };
});

vi.mock("@/integrations/supabase/client", () => {
  const rows = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => rows;
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => chain,
      channel: realtime.channel,
      removeChannel: (c: { topic: string }) => {
        realtime.channels.delete(c.topic);
      },
    },
  };
});

vi.mock("@/lib/payments", () => ({
  getGamePaymentSettings: async () => null,
  getMyJoinRequest: async () => null,
  listMySubmissionsForGame: async () => [],
}));

import { useMyFlowStatus } from "@/lib/game-flow-status";

const GAME = "host-mvli8ois-0sa6";

afterEach(() => {
  cleanup();
  realtime.channels.clear();
  realtime.topics.length = 0;
});

describe("useMyFlowStatus realtime channel", () => {
  it("two components watching the same game and user do not break each other", async () => {
    const a = renderHook(() => useMyFlowStatus(GAME));
    const b = renderHook(() => useMyFlowStatus(GAME));
    await waitFor(() => expect(realtime.topics.length).toBe(2));
    expect(a.result.current.status).toBeDefined();
    expect(b.result.current.status).toBeDefined();
    expect(new Set(realtime.topics).size).toBe(2);
    for (const t of realtime.topics) expect(t.startsWith(`flow-status:${GAME}:user-1:`)).toBe(true);
  });

  it("re-mounting before the old channel is removed does not throw", async () => {
    const first = renderHook(() => useMyFlowStatus(GAME));
    await waitFor(() => expect(realtime.topics.length).toBe(1));
    first.unmount();
    const second = renderHook(() => useMyFlowStatus(GAME));
    await waitFor(() => expect(realtime.topics.length).toBe(2));
    expect(second.result.current.loading).toBeDefined();
    expect(new Set(realtime.topics).size).toBe(2);
  });
});
