// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The notification hooks' realtime channels: each is opened with wait, so SUBSCRIBED means changes are live, and the
 * count hooks count again on every SUBSCRIBED, since the read on mount may have been answered before that.
 */

type StatusCb = (status: string, err?: Error) => void;
const rt = vi.hoisted(() => ({
  opened: [] as { name: string; options: unknown; subscribeArgs?: unknown[] }[],
  // Answers for the count queries, in the order they are sent; each resolves when the test says.
  pending: [] as ((count: number) => void)[],
  user: { id: "me" } as { id: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is"]) query[m] = () => query;
  query.then = (resolve: (v: unknown) => unknown) =>
    new Promise<number>((answer) => rt.pending.push(answer)).then((count) =>
      resolve({ count, error: null }),
    );
  return {
    supabase: {
      from: () => query,
      channel: (name: string, options?: unknown) => {
        const entry: (typeof rt.opened)[number] = { name, options };
        rt.opened.push(entry);
        const channel = {
          on: () => channel,
          subscribe: (...args: unknown[]) => {
            entry.subscribeArgs = args;
            return channel;
          },
        };
        return channel;
      },
      removeChannel: () => {},
    },
  };
});
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: rt.user }) }));
vi.mock("@/lib/notification-prefs", () => ({ isAllowed: () => true }));
vi.mock("@/lib/deep-links", () => ({ openDeepLink: () => {} }));
vi.mock("@/lib/onesignal", () => ({ optInOneSignalPush: vi.fn() }));

import {
  useNotificationPush,
  useUnreadMessageCount,
  useUnreadNotificationCountState,
} from "./notifications";

const WAIT = { config: { postgres_changes_options: { wait: true } } };

const channel = (name: string) => rt.opened.find((c) => c.name === name)!;
const sendStatus = async (name: string, status: string) => {
  const cb = channel(name).subscribeArgs![0] as StatusCb;
  await act(async () => cb(status));
};
const answer = async (index: number, count: number) => {
  await act(async () => rt.pending[index]!(count));
};

beforeEach(() => {
  rt.opened.length = 0;
  rt.pending.length = 0;
  rt.user = { id: "me" };
});
afterEach(() => cleanup());

describe("useUnreadNotificationCountState", () => {
  it("opens its channel with wait under the same topic", () => {
    renderHook(() => useUnreadNotificationCountState("alerts-panel-"));
    expect(channel("notif-count-alerts-panel-me").options).toStrictEqual(WAIT);
  });

  it("counts again on the first SUBSCRIBED and on each rejoin", async () => {
    const { result } = renderHook(() => useUnreadNotificationCountState("t-"));
    // Let the read on mount reach the query.
    await act(async () => {});
    expect(rt.pending).toHaveLength(1);
    await answer(0, 1);
    expect(result.current.count).toBe(1);

    await sendStatus("notif-count-t-me", "SUBSCRIBED");
    expect(rt.pending).toHaveLength(2);
    await answer(1, 2);
    expect(result.current.count).toBe(2);

    await sendStatus("notif-count-t-me", "CHANNEL_ERROR");
    expect(rt.pending).toHaveLength(2);
    await sendStatus("notif-count-t-me", "SUBSCRIBED");
    expect(rt.pending).toHaveLength(3);
    await answer(2, 3);
    expect(result.current.count).toBe(3);
  });

  it("keeps the newest count when the read on mount answers last", async () => {
    const { result } = renderHook(() => useUnreadNotificationCountState("t-"));
    await sendStatus("notif-count-t-me", "SUBSCRIBED");
    await answer(1, 5);
    await answer(0, 4);
    expect(result.current.count).toBe(5);
  });
});

describe("useUnreadMessageCount", () => {
  it("opens its channel with wait and counts again on SUBSCRIBED", async () => {
    const { result } = renderHook(() => useUnreadMessageCount());
    expect(channel("notif-msg-count-me").options).toStrictEqual(WAIT);
    await sendStatus("notif-msg-count-me", "SUBSCRIBED");
    expect(rt.pending).toHaveLength(2);
    await answer(1, 7);
    await answer(0, 6);
    expect(result.current).toBe(7);
  });
});

describe("useNotificationPush", () => {
  it("opens its channel with wait and re-reads nothing on SUBSCRIBED, since a re-read would toast again", () => {
    renderHook(() => useNotificationPush());
    const push = channel("notif-push-me");
    expect(push.options).toStrictEqual(WAIT);
    expect(push.subscribeArgs).toEqual([]);
    expect(rt.pending).toHaveLength(0);
  });
});
