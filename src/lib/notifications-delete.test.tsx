// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// Deleting an unread notification must lower the badge. Supabase cannot filter
// DELETE events, so the count hooks listen unfiltered and re-count unless the old
// row names another user.
const rt = vi.hoisted(() => ({
  deletes: [] as { filter?: string; cb: (p: unknown) => void }[],
  counts: { n: 0 },
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.neq = () => q;
  q.is = async () => {
    rt.counts.n += 1;
    return { count: 2 };
  };
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

import { useUnreadNotificationCount } from "@/lib/notifications";

afterEach(() => {
  cleanup();
  rt.deletes.length = 0;
  rt.counts.n = 0;
});

describe("unread notification count and deletes", () => {
  it("re-counts on an unfiltered delete unless the old row names another user", async () => {
    renderHook(() => useUnreadNotificationCount("t"));
    await waitFor(() => expect(rt.deletes.length).toBe(1));
    expect(rt.deletes[0].filter).toBeUndefined();
    await waitFor(() => expect(rt.counts.n).toBe(1));
    rt.deletes[0].cb({ old: { id: "n1" } });
    await waitFor(() => expect(rt.counts.n).toBe(2));
    rt.deletes[0].cb({ old: { id: "n2", user_id: "someone-else" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(rt.counts.n).toBe(2);
  });
});
