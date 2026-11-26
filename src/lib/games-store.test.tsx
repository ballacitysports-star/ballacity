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
  // When set, the roster read fails with it.
  rosterError: null as { message: string } | null,
  // When set, reading the stored session fails with it.
  sessionError: null as { message: string } | null,
  // The user each roster read asked for, in the order the reads were sent.
  rosterReads: [] as string[],
  // When set, a leave's DELETE waits for it; when the DELETE goes through, the game leaves `roster`.
  deleteGate: null as Promise<void> | null,
  // When set, a leave's DELETE fails with it.
  deleteError: null as { message: string } | null,
};

const toastError = vi.fn();

function table() {
  return {
    select: () => ({
      eq: async (_column: string, userId: string) => {
        server.rosterReads.push(userId);
        const data = server.roster.map((game_id) => ({ id: `row-${game_id}`, game_id }));
        if (server.rosterGate) await server.rosterGate;
        if (server.rosterError) return { data: null, error: server.rosterError };
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
    delete: () => ({
      eq: (_column: string, gameId: string) => ({
        eq: async () => {
          if (server.deleteGate) await server.deleteGate;
          if (server.deleteError) return { error: server.deleteError };
          server.roster = server.roster.filter((g) => g !== gameId);
          return { error: null };
        },
      }),
    }),
  };
}

type RosterPayload = { eventType: string; new?: unknown; old?: unknown };
const realtime = {
  handlers: [] as Array<(p: RosterPayload) => void>,
  authListener: null as null | ((event: string, session: unknown) => void),
  // What each channel was opened with, and the status callback each subscribe was given, in order.
  opened: [] as Array<{ name: string; options: unknown }>,
  statusCallbacks: [] as Array<((status: string) => void) | undefined>,
};

const channel: {
  on: (type: string, filter: unknown, cb: (p: RosterPayload) => void) => typeof channel;
  subscribe: (cb?: (status: string) => void) => typeof channel;
} = {
  on: (_type, _filter, cb) => {
    realtime.handlers.push(cb);
    return channel;
  },
  subscribe: (cb) => {
    realtime.statusCallbacks.push(cb);
    return channel;
  },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () =>
        server.sessionError
          ? { data: { session: null }, error: server.sessionError }
          : {
              data: { session: server.userId ? { user: { id: server.userId } } : null },
              error: null,
            },
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        realtime.authListener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from: () => table(),
    channel: (name: string, options?: unknown) => {
      realtime.opened.push({ name, options });
      return channel;
    },
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
  server.rosterError = null;
  server.sessionError = null;
  toastError.mockReset();
  server.rosterReads = [];
  server.deleteGate = null;
  server.deleteError = null;
  realtime.handlers = [];
  realtime.authListener = null;
  realtime.opened = [];
  realtime.statusCallbacks = [];
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
    expect(toastError).toHaveBeenCalledWith("This game is full.");
    expect(JSON.parse(window.localStorage.getItem("openrun.joinedGameIds.v1") ?? "[]")).toEqual([]);
  });

  it("counts a refusal as joined when the player's own row is already on the roster", async () => {
    // Accepting an invitation to a free game puts the player on the roster (20261127120000). If that row took the last
    // place, the game page's auto-join is refused as full by the join gate before the unique key answers.
    server.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    server.roster = ["g1"];
    const { joinGame, isJoined } = await loadStore();
    await expect(joinGame("g1")).resolves.toBe(true);
    expect(isJoined("g1")).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("still reports the refusal when the player's row is for another game", async () => {
    server.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    server.roster = ["g2"];
    const { joinGame, isJoined } = await loadStore();
    await expect(joinGame("g1")).resolves.toBe(false);
    expect(isJoined("g1")).toBe(false);
    expect(toastError).toHaveBeenCalledWith("This game is full.");
  });

  it("points a player who lost the last spot at the waitlist when the host kept one", async () => {
    server.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    const { joinGame } = await loadStore();
    await expect(joinGame("g1", undefined, { allowWaitlist: true })).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      "This game is full. You can join the waitlist instead.",
    );
  });

  it("does not mention a waitlist the host turned off", async () => {
    server.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    const { joinGame } = await loadStore();
    await expect(joinGame("g1", undefined, { allowWaitlist: false })).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledWith("This game is full.");
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

describe("catching up when the roster channel joins", () => {
  /** Mounts the store for u1 with `roster`, and waits for the first load and the channel. */
  async function mounted(roster: string[]) {
    server.roster = roster;
    const store = await loadStore();
    const { result } = renderHook(() => store.useJoinedGameIds());
    await waitFor(() => expect(result.current).toEqual([...roster].sort()));
    expect(realtime.handlers).toHaveLength(1);
    // Optional call: a store that passes no status callback must fail on what it shows, not on a TypeError here.
    const joinedStatus = (status: string, callback = realtime.statusCallbacks.at(-1)) =>
      act(async () => {
        callback?.(status);
        await Promise.resolve();
      });
    return { store, result, joinedStatus };
  }

  const flush = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

  it("opens the channel holding SUBSCRIBED until the server streams the changes", async () => {
    await mounted([]);
    expect(realtime.opened).toEqual([
      {
        name: "game_participants:me:u1",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
  });

  it("reads the roster again on SUBSCRIBED and shows a join the channel never delivered", async () => {
    const { result, joinedStatus } = await mounted(["g1"]);
    const readsBefore = server.rosterReads.length;
    // Joined on another device while this page was loading: the INSERT came before the subscription was live.
    server.roster = ["g1", "missed"];
    await joinedStatus("SUBSCRIBED");
    await waitFor(() => expect(result.current).toEqual(["g1", "missed"]));
    expect(server.rosterReads.slice(readsBefore)).toEqual(["u1"]);
    // It reads again on every rejoin (a dropped connection), not only the first.
    server.roster = ["g1"];
    await joinedStatus("CHANNEL_ERROR");
    await joinedStatus("SUBSCRIBED");
    await waitFor(() => expect(result.current).toEqual(["g1"]));
    expect(server.rosterReads.slice(readsBefore)).toEqual(["u1", "u1"]);
  });

  it("learns the missed row's id, so a leave on another device that names only the row id is applied", async () => {
    const { result, joinedStatus } = await mounted([]);
    server.roster = ["missed"];
    await joinedStatus("SUBSCRIBED");
    await waitFor(() => expect(result.current).toEqual(["missed"]));
    act(() => realtime.handlers[0]!({ eventType: "DELETE", old: { id: "row-missed" }, new: {} }));
    expect(result.current).toEqual([]);
  });

  it("reads nothing for a SUBSCRIBED that comes after sign-out", async () => {
    const { result, joinedStatus } = await mounted(["g1"]);
    const oldChannelStatus = realtime.statusCallbacks.at(-1);
    act(() => realtime.authListener?.("SIGNED_OUT", null));
    expect(result.current).toEqual([]);
    const readsBefore = server.rosterReads.length;
    await joinedStatus("SUBSCRIBED", oldChannelStatus);
    await flush();
    expect(server.rosterReads.length).toBe(readsBefore);
    expect(result.current).toEqual([]);
  });

  it("reads nothing for the old account when its channel reports SUBSCRIBED after a switch", async () => {
    const { result, joinedStatus } = await mounted(["g1"]);
    const oldChannelStatus = realtime.statusCallbacks.at(-1);
    server.userId = "u2";
    server.roster = ["u2-game"];
    act(() => realtime.authListener?.("SIGNED_IN", { user: { id: "u2" } }));
    await waitFor(() => expect(result.current).toEqual(["u2-game"]));
    const readsBefore = server.rosterReads.length;
    await joinedStatus("SUBSCRIBED", oldChannelStatus);
    await flush();
    expect(server.rosterReads.slice(readsBefore)).not.toContain("u1");
    expect(result.current).toEqual(["u2-game"]);
  });

  it("keeps a realtime INSERT that arrives while the catch-up read is out", async () => {
    const { result, joinedStatus } = await mounted([]);
    let release!: () => void;
    server.rosterGate = new Promise<void>((r) => (release = r));
    const readsBefore = server.rosterReads.length;
    await joinedStatus("SUBSCRIBED");
    expect(server.rosterReads.length).toBe(readsBefore + 1);
    act(() =>
      realtime.handlers[0]!({
        eventType: "INSERT",
        old: {},
        new: { id: "row-late", game_id: "g7", user_id: "u1" },
      }),
    );
    expect(result.current).toEqual(["g7"]);
    // The read answers with the roster from before the INSERT.
    await act(async () => {
      release();
      await server.rosterGate;
    });
    await flush();
    expect(result.current).toEqual(["g7"]);
  });

  it("keeps a realtime DELETE and a leave here that come while the catch-up read is out", async () => {
    const { store, result, joinedStatus } = await mounted(["g1", "g2"]);
    let release!: () => void;
    server.rosterGate = new Promise<void>((r) => (release = r));
    const readsBefore = server.rosterReads.length;
    await joinedStatus("SUBSCRIBED");
    expect(server.rosterReads.length).toBe(readsBefore + 1);
    act(() => realtime.handlers[0]!({ eventType: "DELETE", old: { id: "row-g1" }, new: {} }));
    act(() => store.leaveGame("g2"));
    expect(result.current).toEqual([]);
    // The read answers with both rows still there.
    await act(async () => {
      release();
      await server.rosterGate;
    });
    await flush();
    expect(result.current).toEqual([]);
  });

  it("does not let the first load, answering last, undo what the later catch-up read found", async () => {
    // The first load is sent before the subscription is live and is slow to answer.
    let releaseFirst!: () => void;
    server.rosterGate = new Promise<void>((r) => (releaseFirst = r));
    const firstGate = server.rosterGate;
    const store = await loadStore();
    const { result } = renderHook(() => store.useJoinedGameIds());
    await waitFor(() => expect(server.rosterReads).toHaveLength(1));
    // A join on another device lands before the subscription is live: the channel never delivers it.
    server.roster = ["missed"];
    server.rosterGate = null;
    await act(async () => {
      realtime.statusCallbacks.at(-1)?.("SUBSCRIBED");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current).toEqual(["missed"]));
    // Now the first load answers, with the roster from before the join.
    await act(async () => {
      releaseFirst();
      await firstGate;
    });
    await flush();
    expect(result.current).toEqual(["missed"]);
  });
});

describe("useRosterLoadState (whether useIsJoined has been read from the database)", () => {
  it("is 'loading' while only the saved list is known, then 'ready' with the roster", async () => {
    // Saved on this device, but the host has since removed them: the saved list alone would say "joined".
    window.localStorage.setItem("openrun.joinedGameIds.v1", JSON.stringify(["removed"]));
    let release!: () => void;
    server.rosterGate = new Promise<void>((r) => (release = r));
    const store = await loadStore();
    const { result } = renderHook(() => ({
      load: store.useRosterLoadState(),
      joined: store.useIsJoined("removed"),
    }));
    expect(result.current).toEqual({ load: "loading", joined: true });
    await act(async () => release());
    await waitFor(() => expect(result.current).toEqual({ load: "ready", joined: false }));
  });

  it("is 'error' when the first read fails, and 'ready' after a retry that answers", async () => {
    server.roster = ["g1"];
    server.rosterError = { message: "network down" };
    const store = await loadStore();
    const { result } = renderHook(() => ({
      load: store.useRosterLoadState(),
      joined: store.useIsJoined("g1"),
    }));
    await waitFor(() => expect(result.current.load).toBe("error"));
    expect(result.current.joined).toBe(false);
    server.rosterError = null;
    act(() => store.retryRosterLoad());
    await waitFor(() => expect(result.current).toEqual({ load: "ready", joined: true }));
  });

  it("is 'error', not 'ready', when the session cannot be read, and 'ready' after a retry", async () => {
    server.roster = ["g1"];
    server.sessionError = { message: "refresh failed" };
    const store = await loadStore();
    const { result } = renderHook(() => ({
      load: store.useRosterLoadState(),
      joined: store.useIsJoined("g1"),
    }));
    await waitFor(() => expect(result.current.load).toBe("error"));
    server.sessionError = null;
    act(() => store.retryRosterLoad());
    await waitFor(() => expect(result.current).toEqual({ load: "ready", joined: true }));
  });

  it("is 'ready' with no places when nobody is signed in", async () => {
    server.userId = null;
    const store = await loadStore();
    const { result } = renderHook(() => store.useRosterLoadState());
    await waitFor(() => expect(result.current).toBe("ready"));
  });

  it("keeps 'ready' when a later refresh fails", async () => {
    server.roster = ["g1"];
    const store = await loadStore();
    const { result } = renderHook(() => store.useRosterLoadState());
    await waitFor(() => expect(result.current).toBe("ready"));
    server.rosterError = { message: "network down" };
    act(() => store.retryRosterLoad());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe("ready");
  });

  it("is 'loading' again for another account until its roster is read", async () => {
    server.roster = ["g1"];
    const store = await loadStore();
    const { result } = renderHook(() => store.useRosterLoadState());
    await waitFor(() => expect(result.current).toBe("ready"));
    let release!: () => void;
    server.rosterGate = new Promise<void>((r) => (release = r));
    server.userId = "u2";
    act(() => realtime.authListener?.("SIGNED_IN", { user: { id: "u2" } }));
    expect(result.current).toBe("loading");
    await act(async () => release());
    await waitFor(() => expect(result.current).toBe("ready"));
  });
});

describe("reloadRoster (the pay page after a PayPal capture)", () => {
  it("resolves once the database's places are in, without waiting for a realtime INSERT", async () => {
    const store = await loadStore();
    const { result } = renderHook(() => ({
      load: store.useRosterLoadState(),
      joined: store.useIsJoined("paid-game"),
    }));
    await waitFor(() => expect(result.current).toEqual({ load: "ready", joined: false }));
    // The capture put the viewer on the roster; the INSERT event never arrives.
    server.roster = ["paid-game"];
    let release!: () => void;
    server.rosterGate = new Promise<void>((r) => (release = r));
    let done = false;
    const reload = store.reloadRoster().then(() => {
      done = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(done).toBe(false);
    expect(result.current.joined).toBe(false);
    await act(async () => {
      release();
      await reload;
    });
    expect(done).toBe(true);
    expect(result.current).toEqual({ load: "ready", joined: true });
  });

  it("resolves, and keeps what it had, when the read fails", async () => {
    server.roster = ["kept"];
    const store = await loadStore();
    const { result } = renderHook(() => store.useIsJoined("kept"));
    await waitFor(() => expect(result.current).toBe(true));
    server.rosterError = { message: "network" };
    await act(async () => {
      await store.reloadRoster();
    });
    expect(result.current).toBe(true);
    expect(store.isJoined("kept")).toBe(true);
  });
});

describe("leaving while a roster read is out", () => {
  async function mounted(roster: string[]) {
    server.roster = roster;
    const store = await loadStore();
    const { result } = renderHook(() => store.useJoinedGameIds());
    await waitFor(() => expect(result.current).toEqual([...roster].sort()));
    // A SUBSCRIBED (or any refresh) sends a roster read at the moment the test chooses.
    const read = () =>
      act(async () => {
        realtime.statusCallbacks.at(-1)?.("SUBSCRIBED");
        await Promise.resolve();
      });
    return { store, result, read };
  }

  const flush = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

  it("does not put the game back for a read sent after the tap that answers before the DELETE commits", async () => {
    const { store, result, read } = await mounted(["g1"]);
    let releaseDelete!: () => void;
    server.deleteGate = new Promise<void>((r) => (releaseDelete = r));
    act(() => store.leaveGame("g1"));
    expect(result.current).toEqual([]);
    // The read is served while the row is still there.
    await read();
    await flush();
    expect(result.current).toEqual([]);
    await act(async () => {
      releaseDelete();
      await server.deleteGate;
    });
    await flush();
    expect(result.current).toEqual([]);
  });

  it("does not put the game back for a read sent before the DELETE committed that answers after it", async () => {
    const { store, result, read } = await mounted(["g1"]);
    let releaseDelete!: () => void;
    server.deleteGate = new Promise<void>((r) => (releaseDelete = r));
    act(() => store.leaveGame("g1"));
    // The read sees the row, then is slow to answer.
    let releaseRead!: () => void;
    server.rosterGate = new Promise<void>((r) => (releaseRead = r));
    const readGate = server.rosterGate;
    await read();
    await act(async () => {
      releaseDelete();
      await server.deleteGate;
    });
    await flush();
    expect(server.roster).toEqual([]);
    await act(async () => {
      releaseRead();
      await readGate;
    });
    await flush();
    expect(result.current).toEqual([]);
  });

  it("lets a later read show the game again when the leave failed", async () => {
    // On the roster (the server put them there) but not in this browser's list yet.
    const { store, result, read } = await mounted([]);
    server.roster = ["g1"];
    server.deleteError = { message: "network down" };
    act(() => store.leaveGame("g1"));
    await flush();
    await read();
    await waitFor(() => expect(result.current).toEqual(["g1"]));
  });
});
