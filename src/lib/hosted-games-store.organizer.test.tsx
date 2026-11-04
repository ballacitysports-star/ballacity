// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ tables: [] as string[], games: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    is: () => query,
    eq: () => query,
    in: () => Promise.resolve({ data: h.games, error: null }),
    limit: () => Promise.resolve({ data: [], error: null }),
    order: () => Promise.resolve({ data: h.games, error: null }),
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (t: string) => {
        h.tables.push(t);
        return query;
      },
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

function viewRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    host_id: null,
    organizer_ref: `ref-${id}`,
    viewer_is_host: false,
    organizer_hidden: true,
    sport: "basketball",
    title: id,
    date: "2030-01-01T10:00:00Z",
    duration: "90 min",
    location: "North area",
    neighborhood: "North",
    distance_mi: null,
    lat: null,
    lng: null,
    max_players: 10,
    joined: 0,
    skill: "All Levels",
    price: 0,
    indoor: false,
    is_private: false,
    image: "",
    description: "",
    status: null,
    joins_closed: false,
    host_snapshot: { name: "Youth host", neutral: true },
    min_age: 13,
    max_age: null,
    ...over,
  };
}

async function load() {
  vi.resetModules();
  return import("./hosted-games-store");
}

beforeEach(() => {
  h.tables = [];
  h.games = [];
  window.localStorage.clear();
});

describe("hosted games store reads organizers through hosted_games_public (SEC-5)", () => {
  it("loads the feed from the view, never from the table", async () => {
    h.games = [viewRow("g1")];
    const store = await load();
    const { result } = renderHook(() => store.useHostedGames());
    await waitFor(() => expect(result.current.map((g) => g.id)).toEqual(["g1"]));
    expect(h.tables).toContain("hosted_games_public");
    expect(h.tables).not.toContain("hosted_games");
  });

  it("maps a masked organizer to no host id, keeping the per-game reference", async () => {
    const store = await load();
    const g = store.rowToGameRaw(viewRow("g1") as never);
    expect(g.hostUserId).toBeUndefined();
    expect(g.viewerIsHost).toBe(false);
    expect(g.organizerRef).toBe("ref-g1");
    expect(g.hostNeutral).toBe(true);
    const mine = store.rowToGameRaw(
      viewRow("g2", { host_id: "me", viewer_is_host: true }) as never,
    );
    expect(mine.hostUserId).toBe("me");
    expect(mine.viewerIsHost).toBe(true);
  });

  it("drops the v2 cache, which held host ids read straight from the table", async () => {
    window.localStorage.setItem(
      "openrun.hostedGames.v2",
      JSON.stringify([{ id: "old", hostUserId: "minor-account" }]),
    );
    const store = await load();
    renderHook(() => store.useHostedGames());
    expect(window.localStorage.getItem("openrun.hostedGames.v2")).toBeNull();
  });

  it("treats a realtime event as a signal and never reads host_id from it", async () => {
    const store = await load();
    expect(
      store.realtimeAction({ eventType: "UPDATE", new: { id: "g1", host_id: "x" } as never }),
    ).toEqual({ kind: "refetch", id: "g1" });
    expect(store.realtimeAction({ eventType: "INSERT", new: { id: "g2" } })).toEqual({
      kind: "refetch",
      id: "g2",
    });
    expect(
      store.realtimeAction({ eventType: "UPDATE", new: { id: "g3", hidden_at: "2030-01-01" } }),
    ).toEqual({ kind: "remove", id: "g3" });
    expect(store.realtimeAction({ eventType: "DELETE", old: { id: "g4" } })).toEqual({
      kind: "remove",
      id: "g4",
    });
    expect(store.realtimeAction({ eventType: "UPDATE", new: null })).toBeNull();
  });
});
