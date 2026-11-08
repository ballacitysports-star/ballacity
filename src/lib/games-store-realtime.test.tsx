// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A page that loads with a stored session gets INITIAL_SESSION, not SIGNED_IN.
// The joined-games store attached its realtime channel only on SIGNED_IN /
// USER_UPDATED (or when the user was already known, which it is not yet at
// that point), so a returning member never had a live channel and joins from
// another tab or device did not show up.
const rt = vi.hoisted(() => ({
  topics: [] as string[],
  listener: null as null | ((event: string, session: unknown) => void),
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      auth: {
        // Resolve the user only after the auth event, as on a cold load.
        getUser: () =>
          new Promise((r) => setTimeout(() => r({ data: { user: { id: "u1" } } }), 30)),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          rt.listener = cb;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
      from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
      channel: (topic: string) => {
        rt.topics.push(topic);
        return channel;
      },
      removeChannel: () => {},
    },
  };
});

import { useJoinedGameIds } from "@/lib/games-store";

describe("joined-games realtime channel", () => {
  it("attaches on INITIAL_SESSION for a stored session", async () => {
    renderHook(() => useJoinedGameIds());
    await waitFor(() => expect(rt.listener).not.toBeNull());
    rt.listener!("INITIAL_SESSION", { user: { id: "u1" } });
    await waitFor(() => expect(rt.topics).toContain("game_participants:me:u1"));
  });
});
