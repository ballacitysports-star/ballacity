import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A PostgREST builder that records every call and resolves to `result`.
const db = vi.hoisted(() => {
  const state = {
    calls: [] as unknown[][],
    result: { count: 0 as number | null, error: null as unknown },
    user: { id: "me" } as { id: string } | null,
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "select", "update", "eq", "neq", "is"]) {
    builder[m] = (...args: unknown[]) => {
      state.calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve, reject);
  return { state, builder };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => (db.builder.from as (...a: unknown[]) => unknown)(...args),
    auth: { getUser: async () => ({ data: { user: db.state.user } }) },
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/notification-prefs", () => ({ isAllowed: () => true }));
vi.mock("@/lib/deep-links", () => ({ openDeepLink: () => {} }));
const push = vi.hoisted(() => ({ optIn: vi.fn() }));
vi.mock("@/lib/onesignal", () => ({ optInOneSignalPush: push.optIn }));

import {
  countUnreadNotifications,
  markAllNotificationsRead,
  requestPushPermission,
} from "./notifications";

beforeEach(() => {
  db.state.calls = [];
  db.state.result = { count: 0, error: null };
  db.state.user = { id: "me" };
});

describe("markAllNotificationsRead", () => {
  it("marks every unread notification of the user in one server update, not just the loaded rows", async () => {
    db.state.result = { count: 250, error: null };
    await expect(markAllNotificationsRead("me")).resolves.toBe(250);
    const [from, update, ...filters] = db.state.calls;
    expect(from).toEqual(["from", "notifications"]);
    expect(update[0]).toBe("update");
    expect(Object.keys(update[1] as object)).toEqual(["read_at"]);
    expect(update[2]).toEqual({ count: "exact" });
    expect(filters).toEqual([
      ["eq", "user_id", "me"],
      ["is", "read_at", null],
    ]);
  });

  it("falls back to the signed-in user when no id is passed", async () => {
    await markAllNotificationsRead();
    expect(db.state.calls).toContainEqual(["eq", "user_id", "me"]);
  });

  it("refuses when nobody is signed in, without touching the table", async () => {
    db.state.user = null;
    await expect(markAllNotificationsRead()).rejects.toThrow("AUTH_REQUIRED");
    expect(db.state.calls).toEqual([]);
  });

  it("throws the server's error so the screen can word it", async () => {
    const err = { message: "permission denied for table notifications", code: "42501" };
    db.state.result = { count: null, error: err };
    await expect(markAllNotificationsRead("me")).rejects.toBe(err);
  });
});

describe("countUnreadNotifications", () => {
  it("counts the user's unread notifications on the server with a head-only query", async () => {
    db.state.result = { count: 137, error: null };
    await expect(countUnreadNotifications("me")).resolves.toBe(137);
    expect(db.state.calls).toEqual([
      ["from", "notifications"],
      ["select", "id", { count: "exact", head: true }],
      ["eq", "user_id", "me"],
      ["is", "read_at", null],
    ]);
  });

  it("can leave one type out, as the inbox badge does for messages", async () => {
    await countUnreadNotifications("me", { excludeType: "message" });
    expect(db.state.calls).toContainEqual(["neq", "type", "message"]);
  });

  it("throws on error instead of reporting zero unread", async () => {
    db.state.result = { count: null, error: { message: "offline" } };
    await expect(countUnreadNotifications("me")).rejects.toEqual({ message: "offline" });
  });
});

describe("requestPushPermission", () => {
  const g = globalThis as unknown as { window?: unknown };
  let ask: ReturnType<typeof vi.fn>;

  function browser(permission: NotificationPermission, answer: NotificationPermission = "granted") {
    ask = vi.fn(async () => answer);
    g.window = { Notification: { permission, requestPermission: ask } };
  }

  afterEach(() => {
    delete g.window;
    push.optIn.mockReset();
  });

  it("reports a subscription when the push opt-in succeeds", async () => {
    browser("default");
    push.optIn.mockResolvedValue(true);
    await expect(requestPushPermission()).resolves.toEqual({
      permission: "granted",
      subscribed: true,
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not call an allowed browser a subscription when the opt-in keeps failing", async () => {
    browser("default", "granted");
    push.optIn.mockResolvedValue(false);
    await expect(requestPushPermission()).resolves.toEqual({
      permission: "granted",
      subscribed: false,
    });
    expect(ask).toHaveBeenCalledTimes(1);
    // The opt-in is retried once permission is granted, and its answer is what counts.
    expect(push.optIn).toHaveBeenCalledTimes(2);
  });

  it("counts a retry that succeeds once the browser allows push", async () => {
    browser("default", "granted");
    push.optIn.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(requestPushPermission()).resolves.toEqual({
      permission: "granted",
      subscribed: true,
    });
  });

  it("waits for the subscription when the browser already allows push", async () => {
    browser("granted");
    push.optIn.mockRejectedValue(new Error("blocked by a content blocker"));
    await expect(requestPushPermission()).resolves.toEqual({
      permission: "granted",
      subscribed: false,
    });
  });

  it("does not try to subscribe when the user says no or the browser blocks push", async () => {
    browser("default", "denied");
    push.optIn.mockResolvedValue(false);
    await expect(requestPushPermission()).resolves.toEqual({
      permission: "denied",
      subscribed: false,
    });
    expect(push.optIn).toHaveBeenCalledTimes(1);
    browser("denied");
    push.optIn.mockClear();
    await expect(requestPushPermission()).resolves.toEqual({
      permission: "denied",
      subscribed: false,
    });
    expect(push.optIn).not.toHaveBeenCalled();
  });
});
