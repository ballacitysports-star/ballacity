/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-rolled in-memory Supabase stub */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A server function is its handler for these tests: validate, then run with the given context.
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
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return async (arg: { data?: unknown; context?: unknown }) =>
          fn({ data: validate(arg?.data), context: arg?.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const HOST = "00000000-0000-4000-8000-0000000000a1";
const PLAYER = "00000000-0000-4000-8000-0000000000b2";
const STRANGER = "00000000-0000-4000-8000-0000000000d4";
const G = "host-abc123-def456";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  inserted: [] as any[],
  rpc: vi.fn(),
  pushes: [] as any[],
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const from = (table: string) => {
    let rows = [...(h.tables[table] ?? [])];
    let counting = false;
    const q: any = {
      select: (_c?: string, o?: { count?: string }) => ((counting = !!o?.count), q),
      eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
      in: (k: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[k]))), q),
      gte: (k: string, v: string) => ((rows = rows.filter((r) => String(r[k]) >= v)), q),
      order: () => q,
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) =>
        res(
          counting ? { data: null, count: rows.length, error: null } : { data: rows, error: null },
        ),
      insert: (batch: any[]) => ({
        select: async () => {
          const withIds = batch.map((r, i) => ({ ...r, id: `n${h.inserted.length + i}` }));
          h.inserted.push(...withIds);
          (h.tables[table] ??= []).push(
            ...withIds.map((r) => ({ ...r, created_at: new Date().toISOString() })),
          );
          return { data: withIds.map((r) => ({ id: r.id })), error: null };
        },
      }),
    };
    return q;
  };
  return { supabaseAdmin: { from, rpc: h.rpc } };
});

vi.mock("@/lib/push.server", () => ({
  absolutizeUrl: async (u: string | null) => (u ? `https://app.test${u}` : undefined),
  deliverPush: async (p: unknown) => {
    h.pushes.push(p);
    return { ok: true };
  },
}));

import { createNotificationForUser } from "./notifications.functions";
import * as pushFunctions from "./push.functions";

const call = (userId: string, data: unknown) =>
  createNotificationForUser({ data, context: { userId } } as never) as Promise<{
    ok: true;
    sent: number;
  }>;

beforeEach(() => {
  h.inserted.length = 0;
  h.pushes.length = 0;
  h.rpc.mockReset();
  h.tables = {
    hosted_games: [
      {
        id: G,
        host_id: HOST,
        title: "Thursday Run",
        price: 15,
        date: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        cancel_cutoff_min: 120,
        max_players: 10,
        cancelled_at: null,
        completed_at: null,
        positions_needed: {},
      },
    ],
    game_participants: [{ id: "gp1", game_id: G, user_id: PLAYER }],
    join_requests: [],
    payment_submissions: [],
    profiles: [{ id: HOST, display_name: "Hana" }],
    notifications: [],
    notification_preferences: [],
  };
});

describe("createNotificationForUser", () => {
  it("writes the server's notification and pushes it with an absolute in-app URL", async () => {
    expect(await call(HOST, { type: "payment_reminder", game_id: G, user_id: PLAYER })).toEqual({
      ok: true,
      sent: 1,
    });
    expect(h.inserted).toEqual([
      expect.objectContaining({
        user_id: PLAYER,
        type: "payment_reminder",
        title: "Payment reminder · Thursday Run",
        body: "Your $15 spot for Thursday Run is still unpaid. Tap to pay the host.",
        link: `/games/${G}/pay`,
      }),
    ]);
    expect(h.pushes).toEqual([
      {
        userId: PLAYER,
        title: "Payment reminder · Thursday Run",
        body: "Your $15 spot for Thursday Run is still unpaid. Tap to pay the host.",
        url: `https://app.test/games/${G}/pay`,
        notificationId: "n0",
      },
    ]);
  });

  it("does not ask can_notify: the row decides, not a relationship", async () => {
    await call(HOST, { type: "payment_reminder", game_id: G, user_id: PLAYER });
    await expect(
      call(HOST, { type: "payment_reminder", game_id: G, user_id: STRANGER }),
    ).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses, writing and pushing nothing, when the caller has no standing on the row", async () => {
    await expect(
      call(STRANGER, { type: "payment_reminder", game_id: G, user_id: PLAYER }),
    ).rejects.toThrow("Not authorized to notify this user");
    expect(h.inserted).toEqual([]);
    expect(h.pushes).toEqual([]);
  });

  it("refuses the old free-form request before it reaches the handler", async () => {
    await expect(
      call(HOST, {
        user_id: PLAYER,
        type: "game",
        title: "Your account is locked",
        body: "Sign in again",
        link: "https://evil.example/login",
      }),
    ).rejects.toThrow();
    await expect(
      call(HOST, {
        type: "payment_reminder",
        game_id: G,
        user_id: PLAYER,
        link: "https://evil.example/login",
      }),
    ).rejects.toThrow();
    expect(h.inserted).toEqual([]);
  });

  it("does not send the same thing twice in a row", async () => {
    await call(HOST, { type: "payment_reminder", game_id: G, user_id: PLAYER });
    expect(await call(HOST, { type: "payment_reminder", game_id: G, user_id: PLAYER })).toEqual({
      ok: true,
      sent: 0,
    });
    expect(h.inserted).toHaveLength(1);
    expect(h.pushes).toHaveLength(1);
  });

  it("writes the in-app row but skips the push the recipient turned off", async () => {
    h.tables.notification_preferences = [{ user_id: PLAYER, prefs: { payments: { push: false } } }];
    await call(HOST, { type: "payment_reminder", game_id: G, user_id: PLAYER });
    expect(h.inserted).toHaveLength(1);
    expect(h.pushes).toEqual([]);
  });
});

describe("push to another member", () => {
  it("has no client endpoint any more: it goes out only with the notification it mirrors", () => {
    expect("sendPushToUser" in pushFunctions).toBe(false);
  });
});
