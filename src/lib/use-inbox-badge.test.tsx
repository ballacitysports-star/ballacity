// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Inbox badge's channel is opened with wait, so SUBSCRIBED means changes are live, and the badge counts again
 * on every SUBSCRIBED, since the query on mount may have been answered before that.
 */

type StatusCb = (status: string, err?: Error) => void;
const rt = vi.hoisted(() => ({
  opened: [] as { name: string; options: unknown; onStatus?: StatusCb }[],
  fetchCounts: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string, options?: unknown) => {
      const entry: (typeof rt.opened)[number] = { name, options };
      rt.opened.push(entry);
      const channel = {
        on: () => channel,
        subscribe: (cb?: StatusCb) => {
          entry.onStatus = cb;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: async () => {},
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/messages", () => ({ fetchInboxMessageCounts: rt.fetchCounts }));
// The alerts part has its own channel and its own tests (notifications.realtime.test.tsx).
vi.mock("@/lib/notifications", () => ({ useUnreadNotificationCount: () => 0 }));

import { useInboxBadgeCount } from "./use-inbox-badge";

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  rt.opened.length = 0;
  client = new QueryClient();
});
afterEach(() => {
  cleanup();
  client.clear();
  rt.fetchCounts.mockReset();
});

describe("useInboxBadgeCount", () => {
  it("opens its channel with wait under the same topic", () => {
    rt.fetchCounts.mockResolvedValue({ unread: 0, requests: 0 });
    renderHook(() => useInboxBadgeCount(), { wrapper });
    expect(rt.opened).toHaveLength(1);
    expect(rt.opened[0]).toMatchObject({
      name: "inbox-badge-me",
      options: { config: { postgres_changes_options: { wait: true } } },
    });
  });

  it("counts again on the first SUBSCRIBED and on each rejoin", async () => {
    rt.fetchCounts.mockResolvedValueOnce({ unread: 1, requests: 0 });
    const { result } = renderHook(() => useInboxBadgeCount(), { wrapper });
    await waitFor(() => expect(result.current).toBe(1));
    expect(rt.fetchCounts).toHaveBeenCalledTimes(1);

    // A message written after the query on mount answered but before changes were live.
    rt.fetchCounts.mockResolvedValueOnce({ unread: 2, requests: 1 });
    await act(async () => rt.opened[0]!.onStatus!("SUBSCRIBED"));
    await waitFor(() => expect(result.current).toBe(3));
    expect(rt.fetchCounts).toHaveBeenCalledTimes(2);

    rt.fetchCounts.mockResolvedValueOnce({ unread: 4, requests: 1 });
    await act(async () => rt.opened[0]!.onStatus!("CHANNEL_ERROR"));
    expect(rt.fetchCounts).toHaveBeenCalledTimes(2);
    await act(async () => rt.opened[0]!.onStatus!("SUBSCRIBED"));
    await waitFor(() => expect(result.current).toBe(5));
    expect(rt.fetchCounts).toHaveBeenCalledTimes(3);
  });
});
