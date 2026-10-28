// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The join store is what a player's "You're in" rests on. These pin down that
 * a join reports what the server said, that a refused or signed-out join leaves
 * nothing behind, and that the saved list follows the roster rather than only
 * growing.
 */

const server = {
  userId: "u1" as string | null,
  roster: [] as string[],
  insertError: null as { code?: string; message: string } | null,
  inserted: [] as unknown[],
};

const toastError = vi.fn();

function table() {
  return {
    select: () => ({
      eq: async () => ({ data: server.roster.map((game_id) => ({ game_id })), error: null }),
    }),
    insert: async (row: unknown) => {
      server.inserted.push(row);
      return { error: server.insertError };
    },
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  };
}

const channel: { on: () => typeof channel; subscribe: () => typeof channel } = {
  on: () => channel,
  subscribe: () => channel,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: server.userId ? { id: server.userId } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => table(),
    channel: () => channel,
    removeChannel: () => {},
  },
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

async function loadStore() {
  vi.resetModules();
  return await import("./games-store");
}

beforeEach(() => {
  window.localStorage.clear();
  server.userId = "u1";
  server.roster = [];
  server.insertError = null;
  server.inserted = [];
  toastError.mockReset();
});

describe("joinGame", () => {
  it("resolves true and keeps the game once the server accepts", async () => {
    const { joinGame, isJoined } = await loadStore();
    await expect(joinGame("g1", " Guard ")).resolves.toBe(true);
    expect(isJoined("g1")).toBe(true);
    expect(server.inserted).toEqual([{ game_id: "g1", user_id: "u1", position: "Guard" }]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("counts a duplicate as joined", async () => {
    server.insertError = { code: "23505", message: "duplicate key" };
    const { joinGame, isJoined } = await loadStore();
    await expect(joinGame("g1")).resolves.toBe(true);
    expect(isJoined("g1")).toBe(true);
  });

  it("resolves false, takes the game back and says why when the server refuses", async () => {
    server.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    const { joinGame, isJoined } = await loadStore();
    await expect(joinGame("g1")).resolves.toBe(false);
    expect(isJoined("g1")).toBe(false);
    expect(toastError).toHaveBeenCalledWith("The roster filled up — try the waitlist.");
    expect(JSON.parse(window.localStorage.getItem("openrun.joinedGameIds.v1") ?? "[]")).toEqual([]);
  });

  it("names the missing approval instead of a generic failure", async () => {
    server.insertError = { code: "P0001", message: "GAME_APPROVAL_REQUIRED: ask first" };
    const { joinGame } = await loadStore();
    await joinGame("g1");
    expect(toastError).toHaveBeenCalledWith(
      "The host has to approve your request before you can join.",
    );
  });

  it("does not leave a signed-out visitor marked as joined", async () => {
    server.userId = null;
    const { joinGame, isJoined } = await loadStore();
    await expect(joinGame("g1")).resolves.toBe(false);
    expect(isJoined("g1")).toBe(false);
    expect(server.inserted).toEqual([]);
    expect(toastError).toHaveBeenCalledWith("Sign in to join games.");
  });

  it("does not write twice for a double tap", async () => {
    const { joinGame } = await loadStore();
    const [a, b] = await Promise.all([joinGame("g1"), joinGame("g1")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(server.inserted).toHaveLength(1);
  });
});

describe("saved joined games", () => {
  it("drops a game the roster no longer has, and keeps the ones it does", async () => {
    // Removed by the host while this device was offline: saved locally, not on the roster.
    window.localStorage.setItem("openrun.joinedGameIds.v1", JSON.stringify(["removed", "still"]));
    server.roster = ["still", "other-device"];
    const { useJoinedGameIds } = await loadStore();
    const { result } = renderHook(() => useJoinedGameIds());
    await waitFor(() => expect(result.current).toEqual(["other-device", "still"]));
  });

  it("keeps a join that is still being written when the roster comes back", async () => {
    const { useJoinedGameIds, joinGame } = await loadStore();
    server.roster = [];
    const { result } = renderHook(() => useJoinedGameIds());
    await act(async () => {
      await joinGame("fresh");
    });
    await waitFor(() => expect(result.current).toContain("fresh"));
  });
});
