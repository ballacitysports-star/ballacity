import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Every listener on a user's shared trainer-requests channel reads its request on mount, maybe
 * before the changes were live. The channel opens with wait and calls every listener on each
 * SUBSCRIBED, so each one reads again without its caller doing anything.
 */

const h = vi.hoisted(() => ({
  opened: [] as Array<{ name: string; options: unknown }>,
  status: undefined as undefined | ((status: string) => void),
  removed: 0,
}));

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
      removeChannel: () => {
        h.removed += 1;
      },
    },
  };
});

import { subscribeToMyTrainerRequests } from "./trainer-requests";

afterEach(() => {
  h.opened = [];
  h.status = undefined;
  h.removed = 0;
});

describe("subscribeToMyTrainerRequests", () => {
  it("opens one shared channel per user, holding SUBSCRIBED until the changes are live", () => {
    const offA = subscribeToMyTrainerRequests("u1", () => {});
    const offB = subscribeToMyTrainerRequests("u1", () => {});
    expect(h.opened).toStrictEqual([
      {
        name: "trainer-requests-u1",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
    offA();
    offB();
    expect(h.removed).toBe(1);
  });

  it("calls every listener on every SUBSCRIBED, the first included", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeToMyTrainerRequests("u2", a);
    const offB = subscribeToMyTrainerRequests("u2", b);

    h.status?.("SUBSCRIBED");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    h.status?.("CHANNEL_ERROR");
    expect(a).toHaveBeenCalledTimes(1);

    offB();
    h.status?.("SUBSCRIBED");
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
  });
});
