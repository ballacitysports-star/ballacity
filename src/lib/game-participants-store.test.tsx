// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// The live participant count must keep its realtime channel across re-renders.
// An inline useSyncExternalStore subscribe made React unsubscribe/resubscribe
// on every render, the channel was removed in between, and nothing attached
// it again, so counts stopped updating after the first re-render.
const rt = vi.hoisted(() => {
  const created: string[] = [];
  const removed: string[] = [];
  const channel = (topic: string) => {
    created.push(topic);
    const c = { topic, on: () => c, subscribe: () => c };
    return c;
  };
  return { created, removed, channel };
});

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = async () => ({ count: 3, error: null });
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
      from: () => chain,
      channel: rt.channel,
      removeChannel: (c: { topic: string }) => {
        rt.removed.push(c.topic);
      },
    },
  };
});

import { useLiveParticipantCount } from "@/lib/game-participants-store";

afterEach(() => {
  cleanup();
  rt.created.length = 0;
  rt.removed.length = 0;
});

describe("useLiveParticipantCount realtime channel", () => {
  it("survives re-renders", async () => {
    const { rerender } = renderHook(() => useLiveParticipantCount("host-a-b"));
    await waitFor(() => expect(rt.created.length).toBe(1));
    for (let i = 0; i < 5; i++) rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(rt.removed).toEqual([]);
    expect(rt.created.length).toBe(1);
  });

  it("is removed once the last viewer unmounts", async () => {
    const { unmount } = renderHook(() => useLiveParticipantCount("host-c-d"));
    await waitFor(() => expect(rt.created.length).toBe(1));
    unmount();
    await waitFor(() => expect(rt.removed.length).toBe(1));
  });
});
