import { beforeEach, describe, expect, it, vi } from "vitest";

type Count = { count: number | null; error: { code?: string; message: string } | null };

const state = vi.hoisted(() => ({
  counts: {} as Record<string, { count: number | null; error: unknown }>,
  writes: [] as string[],
  deleted: [] as string[],
  deleteError: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const writeChain = (label: string) => {
    state.writes.push(label);
    const c: Record<string, unknown> = {};
    c.eq = () => c;
    c.then = (resolve: (r: unknown) => unknown) => resolve({ data: null, error: null });
    return c;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => ({
        select: () => ({
          eq: async () => state.counts[table] ?? { count: 0, error: null },
        }),
        update: () => writeChain(`${table}.update`),
        delete: () => writeChain(`${table}.delete`),
      }),
      storage: {
        from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}) }),
      },
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            state.deleted.push(id);
            return { error: state.deleteError };
          },
        },
      },
    },
  };
});

import { purgeUserAccount } from "@/lib/account-purge.server";

const ok = (count = 0): Count => ({ count, error: null });

beforeEach(() => {
  state.counts = {};
  state.writes = [];
  state.deleted = [];
  state.deleteError = null;
});

describe("purgeUserAccount refuses before it erases", () => {
  it("an account that manages a child is refused and nothing is scrubbed or deleted", async () => {
    state.counts.managed_accounts = ok(1);
    await expect(purgeUserAccount("guardian-1")).rejects.toThrow(/manages 1 child profile/);
    expect(state.writes).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("the message says how many children and what to do", async () => {
    state.counts.managed_accounts = ok(2);
    await expect(purgeUserAccount("guardian-1")).rejects.toThrow(
      /2 child profiles.*delete them first/s,
    );
  });

  it("a device pairing the account created also blocks it, before any erasing", async () => {
    state.counts.managed_device_pairings = ok(1);
    await expect(purgeUserAccount("guardian-1")).rejects.toThrow();
    expect(state.writes).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("a failed check is not read as 'no children'", async () => {
    state.counts.managed_accounts = { count: null, error: { code: "XX000", message: "boom" } };
    await expect(purgeUserAccount("guardian-1")).rejects.toThrow();
    expect(state.writes).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("an account that manages no one is erased and deleted as before", async () => {
    await purgeUserAccount("person-1");
    expect(state.writes).toContain("profiles.update");
    expect(state.writes).toContain("highlight_reels.delete");
    expect(state.deleted).toEqual(["person-1"]);
  });

  it("before the managed-children tables exist, nobody manages a child", async () => {
    state.counts.managed_accounts = { count: null, error: { code: "42P01", message: "no table" } };
    state.counts.managed_device_pairings = {
      count: null,
      error: { code: "PGRST205", message: "no table" },
    };
    await purgeUserAccount("person-1");
    expect(state.deleted).toEqual(["person-1"]);
  });

  it("deleting a managed child (who manages no one) is unaffected", async () => {
    await purgeUserAccount("child-1");
    expect(state.deleted).toEqual(["child-1"]);
  });
});
