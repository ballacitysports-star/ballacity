import { beforeEach, describe, expect, it, vi } from "vitest";

// The blocked-accounts list (Settings and the game editor) names the people the viewer blocked through
// public.my_blocked_profiles(), because the profile read rule now hides them (20261126100000). When that function is
// missing (app ahead of the migration, or the migration rolled back) it reads the tables directly, as before.

const h = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as string[],
  tables: [] as string[],
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, unknown[]> = {
    user_blocks: [{ blocked_id: "b1", created_at: "2026-11-20T10:00:00Z" }],
    profiles: [
      { id: "b1", display_name: "Bo", username: "bo", avatar_url: null, avatar_initials: "BO" },
    ],
  };
  const query = (table: string) => {
    h.tables.push(table);
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok, ko),
    };
    return q;
  };
  return {
    supabase: {
      from: query,
      rpc: async (name: string) => {
        h.rpcCalls.push(name);
        return h.rpc;
      },
    },
  };
});

const { fetchBlockedUsers } = await import("./moderation");

beforeEach(() => {
  h.rpcCalls = [];
  h.tables = [];
});

describe("fetchBlockedUsers", () => {
  it("uses my_blocked_profiles and keeps its order; an unnamed account reads 'Blocked account'", async () => {
    h.rpc = {
      data: [
        {
          id: "b2",
          display_name: null,
          username: null,
          avatar_url: null,
          avatar_initials: null,
          blocked_at: "2026-11-20T12:00:00Z",
        },
        {
          id: "b1",
          display_name: "Bo",
          username: "bo",
          avatar_url: "https://x/a.png",
          avatar_initials: "BO",
          blocked_at: "2026-11-20T10:00:00Z",
        },
      ],
      error: null,
    };
    expect(await fetchBlockedUsers("me")).toEqual([
      {
        id: "b2",
        displayName: "Blocked account",
        username: null,
        avatarUrl: null,
        initials: null,
        blockedAt: "2026-11-20T12:00:00Z",
      },
      {
        id: "b1",
        displayName: "Bo",
        username: "bo",
        avatarUrl: "https://x/a.png",
        initials: "BO",
        blockedAt: "2026-11-20T10:00:00Z",
      },
    ]);
    expect(h.rpcCalls).toEqual(["my_blocked_profiles"]);
    expect(h.tables).toEqual([]);
  });

  it("falls back to the direct reads when the function is missing", async () => {
    h.rpc = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };
    expect(await fetchBlockedUsers("me")).toEqual([
      {
        id: "b1",
        displayName: "Bo",
        username: "bo",
        avatarUrl: null,
        initials: "BO",
        blockedAt: "2026-11-20T10:00:00Z",
      },
    ]);
    expect(h.tables).toEqual(["user_blocks", "profiles"]);
  });
});
