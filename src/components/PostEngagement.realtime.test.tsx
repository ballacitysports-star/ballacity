// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Comments and reactions are read on mount and read again on every change. The read on mount may
 * have been answered before the changes were live, so the channel holds SUBSCRIBED until they are
 * and every SUBSCRIBED reads all three lists again.
 */

const h = vi.hoisted(() => ({
  opened: [] as Array<{ name: string; options: unknown }>,
  status: undefined as undefined | ((status: string) => void),
  comments: 0,
  reactions: 0,
  mine: 0,
  user: { id: "u1" } as { id: string } | null,
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/post-engagement.functions", () => ({
  REACTION_EMOJI: ["👍"],
  listComments: async () => {
    h.comments += 1;
    return [];
  },
  listReactions: async () => {
    h.reactions += 1;
    return [];
  },
  listMyReactions: async () => {
    h.mine += 1;
    return [];
  },
  createComment: async () => ({}),
  deleteComment: async () => ({}),
  updateComment: async () => ({}),
  toggleReaction: async () => ({}),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/child-safety", () => ({
  useMyChildStatus: () => ({ can: () => ({ allowed: true }) }),
}));
vi.mock("@/lib/auth-return", () => ({ useAuthSearchHere: () => ({}) }));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: () => channel,
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
      removeChannel: () => {},
    },
  };
});

const { PostEngagement } = await import("./PostEngagement");

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PostEngagement subjectType="team_post" subjectId="p1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  h.opened = [];
  h.status = undefined;
  h.comments = 0;
  h.reactions = 0;
  h.mine = 0;
  h.user = { id: "u1" };
});

describe("PostEngagement realtime catch-up", () => {
  it("opens its channel holding SUBSCRIBED until the changes are live", () => {
    renderIt();
    expect(h.opened).toStrictEqual([
      {
        name: "engagement:team_post:p1",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
  });

  it("reads comments, reactions and the viewer's reactions again on every SUBSCRIBED", async () => {
    renderIt();
    await waitFor(() => expect([h.comments, h.reactions, h.mine]).toStrictEqual([1, 1, 1]));

    act(() => h.status?.("SUBSCRIBED"));
    await waitFor(() => expect([h.comments, h.reactions, h.mine]).toStrictEqual([2, 2, 2]));

    act(() => h.status?.("CHANNEL_ERROR"));
    await new Promise((r) => setTimeout(r, 10));
    expect([h.comments, h.reactions, h.mine]).toStrictEqual([2, 2, 2]);

    act(() => h.status?.("SUBSCRIBED"));
    await waitFor(() => expect([h.comments, h.reactions, h.mine]).toStrictEqual([3, 3, 3]));
  });

  it("waits for live changes for a signed-out viewer too, and catches up on SUBSCRIBED", async () => {
    h.user = null;
    renderIt();
    expect(h.opened).toStrictEqual([
      {
        name: "engagement:team_post:p1",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
    await waitFor(() => expect([h.comments, h.reactions]).toStrictEqual([1, 1]));
    act(() => h.status?.("SUBSCRIBED"));
    await waitFor(() => expect([h.comments, h.reactions]).toStrictEqual([2, 2]));
    expect(h.mine).toBe(0);
  });
});
