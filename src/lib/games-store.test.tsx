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
  // When set, the roster read waits for it, and answers with the roster as it
  // was when the read started (as a real query would).
  rosterGate: null as Promise<void> | null,
};

const toastError = vi.fn();

function table() {
  return {
    select: () => ({
      eq: async () => {
        const data = server.roster.map((game_id) => ({ id: `row-${game_id}`, game_id }));
        if (server.rosterGate) await server.rosterGate;
        return { data, error: null };
      },
    }),
    insert: (row: { game_id: string }) => ({
      select: () => ({
        single: async () => {
          server.inserted.push(row);
          return server.insertError
            ? { data: null, error: server.insertError }
            : { data: { id: `row-${row.game_id}` }, error: null };
        },
      }),
    }),
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  };
}

type RosterPayload = { eventType: string; new?: unknown; old?: unknown };
const realtime = {
  handlers: [] as Array<(p: RosterPayload) => void>,
  authListener: null as null | ((event: string, session: unknown) => void),
};

const channel: {
  on: (type: string, filter: unknown, cb: (p: RosterPayload) => void) => typeof channel;
  subscribe: () => typeof channel;
} = {
  on: (_type, _filter, cb) => {
    realtime.handlers.push(cb);
    return channel;
  },
  subscribe: () => channel,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: server.userId ? { id: server.userId } : null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        realtime.authListener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
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
  server.rosterGate = null;
  toastError.mockReset();
  realtime.handlers = [];
  realtime.authListener = null;
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

describe("realtime roster changes from another device", () => {
  async function mountWithRealtime(roster: string[]) {
    server.roster = roster;
    const store = await loadStore();
    const { result } = renderHook(() => store.useJoinedGameIds());
    await waitFor(() => expect(result.current).toEqual([...roster].sort()));
    expect(realtime.handlers).toHaveLength(1);
    const fire = (p: RosterPayload) => act(() => realtime.handlers[0]!(p));
    return { result, fire };
  }

  it("subscribes on a page that mounts after the session was restored", async () => {
    // Such a page gets no SIGNED_IN, only INITIAL_SESSION for a session it already has.
    server.roster = ["g1"];
    const store = await loadStore();
    const { result } = renderHook(() => store.useJoinedGameIds());
    act(() => realtime.authListener?.("INITIAL_SESSION", { user: { id: "u1" } }));
    await waitFor(() => expect(result.current).toEqual(["g1"]));
    expect(realtime.handlers).toHaveLength(1);
  });

  it("drops a game left on another device, though the DELETE carries only the row id", async () => {
    const { result, fire } = await mountWithRealtime(["g1", "g2"]);
    // What Realtime delivers for a DELETE on a table with row-level security.
    fire({ eventType: "DELETE", old: { id: "row-g1" }, new: {} });
    expect(result.current).toEqual(["g2"]);
    expect(JSON.parse(window.localStorage.getItem("openrun.joinedGameIds.v1") ?? "[]")).toEqual([
      "g2",
    ]);
  });

  it("drops a game joined and then left on another device", async () => {
    const { result, fire } = await mountWithRealtime([]);
    fire({
      eventType: "INSERT",
      old: {},
      new: { id: "row-new", game_id: "g9", user_id: "u1" },
    });
    expect(result.current).toEqual(["g9"]);
    fire({ eventType: "DELETE", old: { id: "row-new" }, new: {} });
    expect(result.current).toEqual([]);
  });

  it("ignores a DELETE for a row it does not know", async () => {
    const { result, fire } = await mountWithRealtime(["g1"]);
    fire({ eventType: "DELETE", old: { id: "unknown-row" }, new: {} });
    expect(result.current).toEqual(["g1"]);
  });

  it("drops a game joined here and left on another device, with no INSERT echo", async () => {
    const store = await loadStore();
    const { result } = renderHook(() => store.useJoinedGameIds());
    await waitFor(() => expect(realtime.handlers).toHaveLength(1));
    await act(async () => {
      await store.joinGame("g5");
    });
    expect(result.current).toEqual(["g5"]);
    // The channel missed the INSERT; the leave elsewhere names only the row id.
    act(() => realtime.handlers[0]!({ eventType: "DELETE", old: { id: "row-g5" }, new: {} }));
    expect(result.current).toEqual([]);
  });

  it("keeps what realtime taught it while an older roster read was out", async () => {
    let release!: () => void;
    server.rosterGate = new Promise<void>((r) => (release = r));
    server.roster = [];
    const store = await loadStore();
    const { result } = renderHook(() => store.useJoinedGameIds());
    await waitFor(() => expect(realtime.handlers).toHaveLength(1));
    // Joined on another device after the read started: the read will not have it.
    act(() =>
      realtime.handlers[0]!({
        eventType: "INSERT",
        old: {},
        new: { id: "row-late", game_id: "g7", user_id: "u1" },
      }),
    );
    expect(result.current).toEqual(["g7"]);
    await act(async () => {
      release();
      await server.rosterGate;
    });
    // The older answer neither takes the game away nor forgets its row.
    await waitFor(() => expect(result.current).toEqual(["g7"]));
    act(() => realtime.handlers[0]!({ eventType: "DELETE", old: { id: "row-late" }, new: {} }));
    expect(result.current).toEqual([]);
  });
});
