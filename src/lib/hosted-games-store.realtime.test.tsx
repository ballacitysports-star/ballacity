// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * A read of hosted_games that was already out when a realtime change arrived can be answered from before that change
 * (a slow or busy backend). It must not put back what it read for that game: the "N spots" pill on the map and the
 * cards would then show the count from before a join or a leave until the next change, which may never come
 * (e2e/join-cross-device-discover-spots.spec.ts failed in CI this way).
 */

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: unknown };
type Deferred = { resolve: (a: Answer) => void };

const h = vi.hoisted(() => ({
  listReads: [] as Deferred[],
  byIdReads: [] as Deferred[],
  onChange: null as null | ((payload: unknown) => void),
  onStatus: null as null | ((status: string) => void),
  opened: [] as { name: string; options: unknown }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const pending = (into: Deferred[]) =>
    new Promise<Answer>((resolve) => {
      into.push({ resolve });
    });
  const query = {
    select: () => query,
    is: () => query,
    eq: () => query,
    order: () => pending(h.listReads),
    maybeSingle: () => pending(h.byIdReads),
  };
  const channel = {
    on: (_type: string, _filter: unknown, cb: (payload: unknown) => void) => {
      h.onChange = cb;
      return channel;
    },
    subscribe: (cb: (status: string) => void) => {
      h.onStatus = cb;
      return channel;
    },
  };
  return {
    supabase: {
      from: () => query,
      channel: (name: string, options?: unknown) => {
        h.opened.push({ name, options });
        return channel;
      },
      removeChannel: () => undefined,
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});

function row(id: string, joined: number, over: Row = {}): Row {
  return {
    id,
    host_id: "host-1",
    sport: "Basketball",
    title: `Game ${id}`,
    date: "2030-01-01T18:00:00.000Z",
    duration: "90 min",
    location: "Court",
    neighborhood: "Here",
    distance_mi: null,
    lat: null,
    lng: null,
    max_players: 10,
    joined,
    skill: "All Levels",
    price: 0,
    indoor: false,
    is_private: false,
    urgent: null,
    trending: null,
    image: "",
    description: "",
    equipment: null,
    status: null,
    joins_closed: false,
    host_snapshot: null,
    hidden_at: null,
    ...over,
  };
}

const update = (r: Row) => ({ eventType: "UPDATE", new: r, old: { id: r.id } });

async function load() {
  vi.resetModules();
  return import("./hosted-games-store");
}

/** Renders the store, answers its first full read with `rows`, and joins the channel (which reads again). */
async function started(rows: Row[]) {
  const store = await load();
  const hook = renderHook(() => ({
    games: store.useHostedGames(),
    g1: store.useHostedGameJoined("g1"),
  }));
  await waitFor(() => expect(h.listReads).toHaveLength(1));
  await act(async () => h.listReads[0]!.resolve({ data: rows, error: null }));
  await waitFor(() => expect(hook.result.current.games).toHaveLength(rows.length));
  // Joining the channel catches up with a second full read, which stays out until a test answers it.
  act(() => h.onStatus!("SUBSCRIBED"));
  await waitFor(() => expect(h.listReads).toHaveLength(2));
  return { store, hook };
}

beforeEach(() => {
  h.listReads = [];
  h.byIdReads = [];
  h.onChange = null;
  h.onStatus = null;
  h.opened = [];
  localStorage.clear();
});

describe("hosted games store: a read that was out when a realtime change arrived", () => {
  it("opens its channel holding SUBSCRIBED until the server streams the changes", async () => {
    // The catch-up read on SUBSCRIBED only covers the changes made before it if the subscription is live by then.
    await started([row("g1", 3)]);
    expect(h.opened).toEqual([
      {
        name: "hosted_games:all",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
  });

  it("does not put back a player count from before a join", async () => {
    const { hook } = await started([row("g1", 3)]);
    expect(hook.result.current.g1).toBe(3);

    // Someone joins while the catch-up read is out; the change arrives first.
    act(() => h.onChange!(update(row("g1", 4))));
    expect(hook.result.current.g1).toBe(4);

    // The read answers from before the join.
    await act(async () => h.listReads[1]!.resolve({ data: [row("g1", 3)], error: null }));
    expect(hook.result.current.g1).toBe(4);
  });

  it("still takes the read's answer for games no change touched, and a later read's answer for all", async () => {
    const { store, hook } = await started([row("g1", 3), row("g2", 1)]);
    act(() => h.onChange!(update(row("g1", 4))));
    await act(async () =>
      h.listReads[1]!.resolve({ data: [row("g1", 3), row("g2", 2)], error: null }),
    );
    const joinedOf = (id: string) => hook.result.current.games.find((g) => g.id === id)?.joined;
    expect(joinedOf("g1")).toBe(4);
    expect(joinedOf("g2")).toBe(2);

    // A read sent after the change is newer than it: its answer wins.
    act(() => h.onStatus!("SUBSCRIBED"));
    await waitFor(() => expect(h.listReads).toHaveLength(3));
    await act(async () =>
      h.listReads[2]!.resolve({ data: [row("g1", 5), row("g2", 2)], error: null }),
    );
    expect(hook.result.current.g1).toBe(5);
    expect(store.getHostedGame("g1")?.joined).toBe(5);
  });

  it("does not bring back a game deleted or hidden while it was out", async () => {
    const { hook } = await started([row("g1", 3), row("g2", 1)]);
    act(() => h.onChange!({ eventType: "DELETE", new: null, old: { id: "g1" } }));
    act(() => h.onChange!(update(row("g2", 1, { hidden_at: "2030-01-01T00:00:00.000Z" }))));
    await act(async () =>
      h.listReads[1]!.resolve({ data: [row("g1", 3), row("g2", 1)], error: null }),
    );
    expect(hook.result.current.games.map((g) => g.id)).toEqual([]);
  });

  it("keeps a game created while it was out that its answer does not have", async () => {
    const { hook } = await started([row("g1", 3)]);
    act(() => h.onChange!({ eventType: "INSERT", new: row("g9", 0), old: null }));
    await act(async () => h.listReads[1]!.resolve({ data: [row("g1", 3)], error: null }));
    expect(hook.result.current.games.map((g) => g.id).sort()).toEqual(["g1", "g9"]);
  });

  it("a read by id does not overwrite a newer realtime copy of that game", async () => {
    const store = await load();
    const hook = renderHook(() => ({
      games: store.useHostedGames(),
      g1: store.useHostedGameJoined("g1"),
    }));
    await waitFor(() => expect(h.listReads).toHaveLength(1));
    // The full read stays out; the page looks the game up by id meanwhile.
    const lookup = store.fetchHostedGame("g1");
    await waitFor(() => expect(h.byIdReads).toHaveLength(1));
    act(() => h.onChange!(update(row("g1", 4))));
    await act(async () => h.byIdReads[0]!.resolve({ data: row("g1", 3), error: null }));
    expect((await lookup)?.joined).toBe(4);
    expect(store.getHostedGame("g1")?.joined).toBe(4);
    // The game page's live count follows this game from the read on, though the full read is still out.
    expect(hook.result.current.g1).toBe(4);
    act(() => h.onChange!(update(row("g1", 5))));
    expect(hook.result.current.g1).toBe(5);
  });
});
