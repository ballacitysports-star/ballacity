import type { RealtimeChannel } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * liveChannel is what makes SUBSCRIBED mean the changes are live, and onLive is what turns each
 * SUBSCRIBED into a re-read. These pin down the exact options sent and when the callback runs.
 */

const mocks = vi.hoisted(() => {
  const channel = {
    subscribe(cb?: (status: string, err?: Error) => void) {
      mocks.subscribed.push(cb);
      return channel;
    },
  };
  return {
    channel,
    opened: [] as { name: string; options: unknown }[],
    subscribed: [] as unknown[],
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string, options?: unknown) => {
      mocks.opened.push({ name, options });
      return mocks.channel;
    },
  },
}));

import { liveChannel, onLive } from "./realtime-channel";

beforeEach(() => {
  mocks.opened.length = 0;
  mocks.subscribed.length = 0;
});

describe("liveChannel", () => {
  it("opens the channel with only wait when no options are given", () => {
    const channel = liveChannel("game_participants:me:u1");
    expect(channel).toBe(mocks.channel);
    expect(mocks.opened).toStrictEqual([
      {
        name: "game_participants:me:u1",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
  });

  it("keeps a presence key alongside wait", () => {
    liveChannel("thread-c1", { config: { presence: { key: "u1" } } });
    expect(mocks.opened[0].options).toStrictEqual({
      config: { presence: { key: "u1" }, postgres_changes_options: { wait: true } },
    });
  });

  it("keeps the caller's wait timeout and forces wait on", () => {
    liveChannel("x", { config: { postgres_changes_options: { wait: false, timeout: 5000 } } });
    expect(mocks.opened[0].options).toStrictEqual({
      config: { postgres_changes_options: { wait: true, timeout: 5000 } },
    });
  });

  it("leaves the caller's options object as it was", () => {
    const opts = { config: { presence: { key: "u1" } } };
    liveChannel("x", opts);
    expect(opts).toStrictEqual({ config: { presence: { key: "u1" } } });
    expect(mocks.opened[0].options).not.toBe(opts);
  });

  it("takes an onLive handler in subscribe", () => {
    const reload = vi.fn();
    // Typed against the real RealtimeChannel, so tsc proves the handler fits subscribe.
    const channel: RealtimeChannel = liveChannel("x");
    channel.subscribe(onLive(reload));
    const handler = mocks.subscribed[0] as (status: string) => void;
    handler("SUBSCRIBED");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("onLive", () => {
  const statuses = ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED", "SUBSCRIBED"];

  it("calls back on every SUBSCRIBED, the first included, and on nothing else", () => {
    const reload = vi.fn();
    const handler = onLive(reload);
    handler("CHANNEL_ERROR");
    expect(reload).not.toHaveBeenCalled();
    handler("SUBSCRIBED");
    expect(reload).toHaveBeenCalledTimes(1);
    for (const status of statuses.slice(1)) handler(status);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("passes every status and its error to the chained handler, before the callback", () => {
    const calls: string[] = [];
    const onStatus = vi.fn((status: string) => calls.push(`status:${status}`));
    const handler = onLive(() => calls.push("reload"), onStatus);
    const err = new Error("RealtimeDisabledForConfiguration");
    handler(statuses[0]);
    handler(statuses[1], err);
    for (const status of statuses.slice(2)) handler(status);
    expect(onStatus.mock.calls).toStrictEqual([
      ["SUBSCRIBED", undefined],
      ["CHANNEL_ERROR", err],
      ["TIMED_OUT", undefined],
      ["CLOSED", undefined],
      ["SUBSCRIBED", undefined],
    ]);
    expect(calls).toStrictEqual([
      "status:SUBSCRIBED",
      "reload",
      "status:CHANNEL_ERROR",
      "status:TIMED_OUT",
      "status:CLOSED",
      "status:SUBSCRIBED",
      "reload",
    ]);
  });
});
