// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const EXACT = { location: "Lincoln Park Court 3, 12 Main St", lat: 33.77412, lng: -84.29631 };

const h = vi.hoisted(() => ({
  session: true as boolean,
  privateRows: [] as unknown[],
  privateError: null as unknown,
  privateQueries: 0,
  games: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const publicQuery = {
    select: () => publicQuery,
    is: () => publicQuery,
    order: () => Promise.resolve({ data: h.games, error: null }),
  };
  const privateQuery = {
    select: () => privateQuery,
    eq: () => privateQuery,
    maybeSingle: () => Promise.resolve({ data: h.privateRows[0] ?? null, error: h.privateError }),
    limit: () => {
      h.privateQueries += 1;
      return Promise.resolve({ data: h.privateRows, error: h.privateError });
    },
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (t: string) => (t === "hosted_game_private" ? privateQuery : publicQuery),
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: h.session ? { user: { id: "u" } } : null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    host_id: "host",
    sport: "basketball",
    title: id,
    date: "2030-01-01T10:00:00Z",
    duration: "90 min",
    // Until the database switch is on, the public columns still hold the exact venue.
    location: EXACT.location,
    neighborhood: "Decatur",
    distance_mi: null,
    lat: EXACT.lat,
    lng: EXACT.lng,
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
    host_snapshot: { name: "Youth host" },
    min_age: 13,
    max_age: 17,
    ...over,
  };
}

async function load() {
  vi.resetModules();
  return import("./hosted-games-store");
}

function useStore(store: Awaited<ReturnType<typeof load>>) {
  return renderHook(() => ({
    games: store.useHostedGames(),
    exact: store.useExactLocationStatus(),
  }));
}

beforeEach(() => {
  localStorage.clear();
  h.session = true;
  h.privateRows = [];
  h.privateError = null;
  h.privateQueries = 0;
  h.games = [
    row("youth"),
    row("adult", { min_age: 18, max_age: null }),
    row("open", { min_age: null, max_age: null }),
  ];
});

// The database decides who is entitled; these cases are who it releases the private row to (per the SQL tests in
// supabase/tests/320) and what the client then shows.
const released = [
  "host",
  "confirmed player",
  "verified guardian of a player",
  "team manager",
  "organization admin",
];
const withheld = [
  "adult stranger",
  "16-17 stranger",
  "13-15 stranger",
  "under-13 stranger",
  "unknown-age account",
  "pending requester",
  "waitlisted player",
  "guardian of a pending requester",
  "guardian with a revoked link",
];

describe("exact youth-game locations on the client", () => {
  it.each(released)("%s: sees the exact venue once the database releases it", async (_who) => {
    h.privateRows = [{ game_id: "youth", ...EXACT }];
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() => expect(result.current.exact).toBe("ready"));
    const g = result.current.games.find((x) => x.id === "youth")!;
    expect(g.location).toBe(EXACT.location);
    expect(g.locationPrecision).toBe("exact");
  });

  it.each(withheld)(
    "%s: gets only the coarse form, even though the public row still carries the venue",
    async (_who) => {
      h.privateRows = [];
      const store = await load();
      const { result } = useStore(store);
      await waitFor(() => expect(result.current.exact).toBe("ready"));
      const g = result.current.games.find((x) => x.id === "youth")!;
      expect(g.location).toBe("Decatur");
      expect(g.lat).toBe(33.77);
      expect(g.lng).toBe(-84.3);
      expect(g.locationPrecision).toBe("approximate");
      expect(JSON.stringify(result.current.games.find((x) => x.id === "youth"))).not.toContain(
        "Lincoln Park",
      );
    },
  );

  it("a game with no age limit is treated as youth-inclusive; an adult-only game stays exact for everyone", async () => {
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() => expect(result.current.exact).toBe("ready"));
    expect(result.current.games.find((x) => x.id === "open")!.location).toBe("Decatur");
    expect(result.current.games.find((x) => x.id === "adult")!.location).toBe(EXACT.location);
  });

  it("signed out: never asks for private rows and shows coarse data", async () => {
    h.session = false;
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() => expect(result.current.exact).toBe("ready"));
    expect(h.privateQueries).toBe(0);
    expect(result.current.games.find((x) => x.id === "youth")!.location).toBe("Decatur");
  });

  it("reports an error state (and stays coarse) when access cannot be checked", async () => {
    h.privateError = { message: "network" };
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() => expect(result.current.exact).toBe("error"));
    expect(result.current.games.find((x) => x.id === "youth")!.location).toBe("Decatur");
  });

  it("retry recovers from the error state", async () => {
    h.privateError = { message: "network" };
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() => expect(result.current.exact).toBe("error"));
    h.privateError = null;
    h.privateRows = [{ game_id: "youth", ...EXACT }];
    store.retryExactLocations();
    await waitFor(() => expect(result.current.exact).toBe("ready"));
    expect(result.current.games.find((x) => x.id === "youth")!.location).toBe(EXACT.location);
  });
});

describe("what is cached on the device", () => {
  it("never writes an exact youth-game venue or coordinate to storage, even for an authorized viewer", async () => {
    h.privateRows = [{ game_id: "youth", ...EXACT }];
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() =>
      expect(result.current.games.find((x) => x.id === "youth")?.locationPrecision).toBe("exact"),
    );
    const stored = JSON.parse(localStorage.getItem("openrun.hostedGames.v2") ?? "[]") as {
      id: string;
      location: string;
      lat: number | null;
    }[];
    const youthText = JSON.stringify(stored.filter((g) => g.id !== "adult"));
    expect(youthText).not.toContain("Lincoln Park");
    expect(youthText).not.toContain("33.774");
    expect(youthText).not.toContain("84.296");
    // the adult-only game is unaffected
    expect(stored.find((g) => g.id === "adult")?.location).toBe(EXACT.location);
  });

  it("deletes the old v1 cache (exact coordinates of every game) on first load", async () => {
    localStorage.setItem(
      "openrun.hostedGames.v1",
      JSON.stringify([{ id: "x", location: EXACT.location, lat: 1, lng: 2 }]),
    );
    const store = await load();
    renderHook(() => store.useHostedGames());
    expect(localStorage.getItem("openrun.hostedGames.v1")).toBeNull();
  });

  it("re-coarsens anything found in the new cache", async () => {
    localStorage.setItem(
      "openrun.hostedGames.v2",
      JSON.stringify([
        {
          id: "stale",
          sport: "basketball",
          title: "s",
          location: EXACT.location,
          neighborhood: "Decatur",
          lat: EXACT.lat,
          lng: EXACT.lng,
          minAge: 13,
          maxAge: 17,
        },
      ]),
    );
    h.games = [];
    h.session = false;
    const store = await load();
    const { result } = renderHook(() => store.useHostedGames());
    const g = result.current.find((x) => x.id === "stale");
    expect(g?.location ?? "Decatur").toBe("Decatur");
  });
});

describe("account switch and sign-out", () => {
  it("forgets every released location when the per-user state is reset", async () => {
    h.privateRows = [{ game_id: "youth", ...EXACT }];
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() =>
      expect(result.current.games.find((x) => x.id === "youth")?.location).toBe(EXACT.location),
    );
    // The next person (or nobody) is signed in: the database releases nothing to them.
    h.session = false;
    h.privateRows = [];
    const { resetPerUserClientState } = await import("./per-user-state");
    await resetPerUserClientState();
    await waitFor(() => {
      const g = result.current.games.find((x) => x.id === "youth");
      expect(g?.location).toBe("Decatur");
    });
    expect(JSON.stringify(result.current.games.filter((x) => x.id !== "adult"))).not.toContain(
      "Lincoln Park",
    );
  });
});

describe("organizer identity of a youth host", () => {
  it("shows only the organizer the database recorded, with no username, photo, rating or profile link", async () => {
    h.games = [
      row("neutral", { host_snapshot: { name: "Riverside Club", neutral: true } }),
      row("neutral-default", { host_snapshot: { neutral: true } }),
      row("adult-host", {
        host_snapshot: { name: "Sam", username: "@sam", avatar: "S", rating: 4.5 },
      }),
    ];
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() => expect(result.current.exact).toBe("ready"));
    const byId = (id: string) => result.current.games.find((g) => g.id === id)!;
    expect(byId("neutral").hostNeutral).toBe(true);
    expect(byId("neutral").host).toEqual({
      name: "Riverside Club",
      username: "",
      avatar: "R",
      rating: 0,
    });
    expect(byId("neutral-default").host.name).toBe("Youth host");
    expect(byId("adult-host").hostNeutral).toBeUndefined();
    expect(byId("adult-host").host.username).toBe("@sam");
  });

  it("does not invent a default identity for a neutral host", async () => {
    h.games = [row("n", { host_snapshot: { neutral: true } })];
    const store = await load();
    const { result } = useStore(store);
    await waitFor(() => expect(result.current.exact).toBe("ready"));
    const g = result.current.games[0];
    expect(g.host.username).not.toBe("@host");
    expect(g.host.rating).toBe(0);
  });
});
