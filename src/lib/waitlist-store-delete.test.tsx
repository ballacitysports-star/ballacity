// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// A waitlist entry removed by its owner (leave) or the host must disappear live.
// Supabase cannot filter DELETE events, so the listener is unfiltered and removes by id.
const rt = vi.hoisted(() => ({
  deletes: [] as { filter?: string; cb: (p: unknown) => void }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const rows = [
    { id: "w1", game_id: "g1", position: "G", user_id: "a", created_at: "t1" },
    { id: "w2", game_id: "g1", position: "F", user_id: "b", created_at: "t2" },
  ];
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.order = async () => ({ data: rows, error: null });
  return {
    supabase: {
      from: () => q,
      channel: () => {
        const c: { on: unknown; subscribe: unknown } = {
          on: (_t: string, spec: { event: string; filter?: string }, cb: (p: unknown) => void) => {
            if (spec.event === "DELETE") rt.deletes.push({ filter: spec.filter, cb });
            return c;
          },
          subscribe: () => c,
        };
        return c;
      },
      removeChannel: () => {},
    },
  };
});

import { useGameWaitlist } from "@/lib/waitlist-store";

afterEach(() => {
  cleanup();
  rt.deletes.length = 0;
});

describe("useGameWaitlist deletes", () => {
  it("drops the deleted entry from an unfiltered listener", async () => {
    const { result } = renderHook(() => useGameWaitlist("g1"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    expect(rt.deletes[0].filter).toBeUndefined();
    act(() => rt.deletes[0].cb({ old: { id: "w1" } }));
    expect(result.current.entries.map((e) => e.id)).toEqual(["w2"]);
    act(() => rt.deletes[0].cb({ old: { id: "other-game-row" } }));
    expect(result.current.entries.length).toBe(1);
  });
});
