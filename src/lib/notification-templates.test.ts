import { beforeEach, describe, expect, it, vi } from "vitest";

// A server function is its handler for these tests: validate the input, then run it with the given context.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context?: unknown }) => unknown) {
        return (arg: { data: unknown; context: unknown }) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const state = {
  cohorts: {} as Record<string, string>,
  inserted: [] as Record<string, unknown>[],
  pushed: [] as Record<string, unknown>[],
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (_fn: string, args: { _user: string }) => ({
      data: state.cohorts[args._user] ?? "unknown",
      error: null,
    }),
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { error: null };
      },
    }),
  },
}));
vi.mock("@/lib/push.server", () => ({
  deliverPush: async (d: Record<string, unknown>) => {
    state.pushed.push(d);
    return { ok: true };
  },
  absolutizeUrl: async (u: string | null) => (u ? `https://app.test${u}` : undefined),
}));

import { minorSafeNotification, shapeNotificationForRecipient } from "./notification-templates";
import { createNotificationForUser } from "./notifications.functions";
import { sendPushToUser } from "./push.functions";

const CALLER = "00000000-0000-4000-8000-000000000001";
const ADULT = "00000000-0000-4000-8000-000000000002";
const MINOR = "00000000-0000-4000-8000-000000000003";
const UNKNOWN = "00000000-0000-4000-8000-000000000004";

const context = {
  userId: CALLER,
  supabase: { rpc: async () => ({ data: true, error: null }) },
};

const hostile = {
  type: "game_broadcast",
  title: "Text me on snap: xyz",
  body: "Meet me at 5, don't tell your parents",
  link: "https://evil.example/lure",
};

beforeEach(() => {
  state.cohorts = { [CALLER]: "adult", [ADULT]: "adult", [MINOR]: "teen_13_15" };
  state.inserted = [];
  state.pushed = [];
});

describe("minorSafeNotification", () => {
  it("uses fixed wording and an in-app link for a known type", () => {
    const n = minorSafeNotification("message");
    expect(n).toEqual({
      type: "message",
      title: "New message",
      body: "Open Messages to read it.",
      link: "/messages",
    });
  });

  it("maps an unknown or caller-invented type to the generic template", () => {
    expect(minorSafeNotification("free text here").type).toBe("general");
    expect(minorSafeNotification("__proto__").type).toBe("general");
    expect(minorSafeNotification(null).title).toBe("New notification");
  });

  it("keeps the caller's content for a confirmed adult or for oneself", () => {
    expect(shapeNotificationForRecipient(hostile, { isSelf: false, isConfirmedAdult: true })).toBe(
      hostile,
    );
    expect(shapeNotificationForRecipient(hostile, { isSelf: true, isConfirmedAdult: false })).toBe(
      hostile,
    );
  });
});

describe("createNotificationForUser", () => {
  it("stores the caller's text for an adult recipient", async () => {
    await createNotificationForUser({ data: { user_id: ADULT, ...hostile }, context } as any);
    expect(state.inserted[0]).toMatchObject({
      title: hostile.title,
      body: hostile.body,
      link: hostile.link,
    });
  });

  it("ignores the caller's title, body and link for a minor", async () => {
    await createNotificationForUser({ data: { user_id: MINOR, ...hostile }, context } as any);
    const row = state.inserted[0]!;
    expect(row).toMatchObject({
      user_id: MINOR,
      type: "game_broadcast",
      title: "Game update",
      link: "/notifications",
    });
    expect(JSON.stringify(row)).not.toMatch(/snap|parents|evil/);
  });

  it("fails closed for a person of unknown age", async () => {
    await createNotificationForUser({ data: { user_id: UNKNOWN, ...hostile }, context } as any);
    expect(state.inserted[0]).toMatchObject({ title: "Game update", link: "/notifications" });
  });
});

describe("sendPushToUser", () => {
  it("pushes the caller's text to an adult", async () => {
    await sendPushToUser({
      data: {
        userId: ADULT,
        title: hostile.title,
        body: hostile.body,
        url: hostile.link,
        type: hostile.type,
      },
      context,
    } as any);
    expect(state.pushed[0]).toMatchObject({ title: hostile.title, url: hostile.link });
  });

  it("pushes only the fixed template to a minor, with an in-app link", async () => {
    await sendPushToUser({
      data: {
        userId: MINOR,
        title: hostile.title,
        body: hostile.body,
        url: hostile.link,
        type: "message",
      },
      context,
    } as any);
    expect(state.pushed[0]).toEqual({
      userId: MINOR,
      title: "New message",
      body: "Open Messages to read it.",
      url: "https://app.test/messages",
    });
  });

  it("uses the generic template when an older client sends no type", async () => {
    await sendPushToUser({
      data: { userId: UNKNOWN, title: hostile.title, body: hostile.body, url: hostile.link },
      context,
    } as any);
    expect(state.pushed[0]).toMatchObject({
      title: "New notification",
      url: "https://app.test/notifications",
    });
  });
});
