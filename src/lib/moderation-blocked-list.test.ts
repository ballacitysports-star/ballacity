import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The block list (Account > Blocked accounts, and the game editor's section).
 * A block hides the blocked person's profile row from the blocker
 * (20261125100000), so the names come from my_blocked_profiles. While that
 * function is missing (before the migration, after its rollback) the list reads
 * user_blocks and profiles, which the old rules allow.
 */

type Result = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  rpc: null as Result | null,
  tables: {} as Record<string, Result>,
  calls: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const supabase = {
    rpc(fn: string) {
      expect(this).toBe(supabase);
      h.calls.push(`rpc:${fn}`);
      return Promise.resolve(h.rpc ?? { data: [], error: null });
    },
    from(table: string) {
      h.calls.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order"]) q[m] = () => q;
      q.then = (resolve: (r: Result) => unknown) =>
        Promise.resolve(h.tables[table] ?? { data: [], error: null }).then(resolve);
      return q;
    },
  };
  return { supabase };
});
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

const { fetchBlockedUsers } = await import("@/lib/moderation");

beforeEach(() => {
  h.rpc = null;
  h.tables = {};
  h.calls = [];
});

describe("fetchBlockedUsers", () => {
  it("names each blocked account from my_blocked_profiles", async () => {
    h.rpc = {
      data: [
        {
          blocked_id: "bob",
          blocked_at: "2026-11-02T00:00:00Z",
          display_name: "Bob",
          username: "bob",
          avatar_initials: "BO",
          avatar_url: "https://example.test/bob.png",
        },
        {
          blocked_id: "carol",
          blocked_at: "2026-11-01T00:00:00Z",
          display_name: "Carol",
          username: null,
          avatar_initials: "CA",
          avatar_url: null,
        },
      ],
      error: null,
    };
    const users = await fetchBlockedUsers("alice");
    expect(users.map((u) => u.displayName)).toEqual(["Bob", "Carol"]);
    expect(users[0]).toEqual({
      id: "bob",
      displayName: "Bob",
      username: "bob",
      avatarUrl: "https://example.test/bob.png",
      initials: "BO",
      blockedAt: "2026-11-02T00:00:00Z",
    });
    // The hidden profile rows are never read.
    expect(h.calls).toEqual(["rpc:my_blocked_profiles"]);
  });

  it("labels an account whose name the blocker may not see", async () => {
    h.rpc = {
      data: [
        {
          blocked_id: "priv",
          blocked_at: "2026-11-02T00:00:00Z",
          display_name: null,
          username: null,
          avatar_initials: null,
          avatar_url: null,
        },
      ],
      error: null,
    };
    const [u] = await fetchBlockedUsers("alice");
    expect(u.displayName).toBe("Blocked account");
  });

  it("reads profiles while my_blocked_profiles is missing", async () => {
    h.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    h.tables.user_blocks = {
      data: [{ blocked_id: "bob", created_at: "2026-11-02T00:00:00Z" }],
      error: null,
    };
    h.tables.profiles = {
      data: [
        {
          id: "bob",
          display_name: "Bob",
          username: "bob",
          avatar_url: null,
          avatar_initials: "BO",
        },
      ],
      error: null,
    };
    const users = await fetchBlockedUsers("alice");
    expect(users.map((u) => u.displayName)).toEqual(["Bob"]);
    expect(h.calls).toEqual(["rpc:my_blocked_profiles", "user_blocks", "profiles"]);
  });

  it("surfaces any other failure instead of an unnamed list", async () => {
    const err = { code: "42501", message: "permission denied" };
    h.rpc = { data: null, error: err };
    await expect(fetchBlockedUsers("alice")).rejects.toBe(err);
    expect(h.calls).toEqual(["rpc:my_blocked_profiles"]);
  });
});
