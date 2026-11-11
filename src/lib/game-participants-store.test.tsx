// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useState } from "react";

/**
 * "N spots left" (useLiveParticipantCount) follows hosted_games.joined in the
 * hosted-games store: the game_participants_sync_count trigger keeps that column
 * equal to the game's participant rows, and the store's one hosted_games channel
 * streams it. No card opens a channel or runs a count query of its own (P2-6).
 */

type Row = { id: string; joined: number; max_players: number };
type Handler = (payload: { eventType: string; new?: unknown; old?: unknown }) => void;

const db = vi.hoisted(() => ({
  rows: [] as { id: string; joined: number; max_players: number }[],
  channels: [] as string[],
  handlers: [] as ((payload: { eventType: string; new?: unknown; old?: unknown }) => void)[],
  queries: [] as string[],
  subscribed: [] as ((status: string) => void)[],
  auth: [] as ((event: string) => void)[],
  // A load can be held open, to see that catch-up loads never overlap.
  hold: null as Promise<void> | null,
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const row = (r: Row) => ({
    sport: "Basketball",
    title: `Game ${r.id}`,
    host_snapshot: {},
    host_id: "host-1",
    date: "2026-11-12T18:00:00Z",
    duration: "60 min",
    location: "Court",
    neighborhood: "Town",
    skill: "All Levels",
    price: 0,
    hidden_at: null,
    ...r,
  });
  return {
    supabase: {
      from(table: string) {
        const builder = {
          select(_cols: string, opts?: { head?: boolean }) {
            db.queries.push(`${table}${opts?.head ? ":head-count" : ""}`);
            return builder;
          },
          is() {
            return builder;
          },
          order() {
            return builder;
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            db.inFlight += 1;
            db.maxInFlight = Math.max(db.maxInFlight, db.inFlight);
            const answer = () => {
              db.inFlight -= 1;
              return { data: db.rows.map(row), error: null };
            };
            return (db.hold ? db.hold.then(answer) : Promise.resolve().then(answer)).then(
              resolve,
              reject,
            );
          },
        };
        return builder;
      },
      channel(name: string) {
        db.channels.push(name);
        const ch = {
          on(_t: string, _opts: unknown, handler: Handler) {
            db.handlers.push(handler);
            return ch;
          },
          subscribe(cb?: (status: string) => void) {
            if (cb) db.subscribed.push(cb);
            return ch;
          },
        };
        return ch;
      },
      removeChannel() {},
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "viewer" } } } }),
        onAuthStateChange: (cb: (event: string) => void) => {
          db.auth.push(cb);
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    },
  };
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

function updateRow(id: string, joined: number) {
  for (const h of db.handlers) {
    h({ eventType: "UPDATE", new: { ...db.rows.find((r) => r.id === id), joined } });
  }
}

describe("useLiveParticipantCount", () => {
  it("follows the store's hosted_games.joined and never opens a channel of its own", async () => {
    // A stale copy restored from localStorage must not be shown as live.
    window.localStorage.setItem(
      "openrun.hostedGames.v1",
      JSON.stringify([{ id: "g-a", joined: 99, maxPlayers: 10 }]),
    );
    db.rows = [
      { id: "g-a", joined: 3, max_players: 10 },
      { id: "g-b", joined: 0, max_players: 8 },
    ];
    const { useHostedGames } = await import("@/lib/hosted-games-store");
    const { useLiveParticipantCount } = await import("@/lib/game-participants-store");

    let bump = () => {};
    const seen: (number | undefined)[] = [];
    function Card({ id }: { id: string }) {
      const n = useLiveParticipantCount(id);
      if (id === "g-a") seen.push(n);
      return <span data-testid={id}>{n === undefined ? "fallback" : n}</span>;
    }
    function Feed() {
      useHostedGames(); // the list page that keeps the store live
      const [tick, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      return (
        <div data-tick={tick}>
          <Card id="g-a" />
          <Card id="g-b" />
          <Card id="not-hosted" />
        </div>
      );
    }

    const view = render(<Feed />);
    expect(seen[0]).toBeUndefined(); // the localStorage copy (99) is not trusted
    await settle();
    expect(view.getByTestId("g-a").textContent).toBe("3");
    expect(view.getByTestId("g-b").textContent).toBe("0");
    expect(view.getByTestId("not-hosted").textContent).toBe("fallback");
    expect(seen).not.toContain(99);

    await act(async () => updateRow("g-a", 4));
    expect(view.getByTestId("g-a").textContent).toBe("4");
    await act(async () => bump());
    await act(async () => bump());
    expect(view.getByTestId("g-a").textContent).toBe("4");
    await act(async () => updateRow("g-a", 2));
    expect(view.getByTestId("g-a").textContent).toBe("2");

    expect(db.channels).toEqual(["hosted_games:all"]);
    expect(db.queries.filter((q) => q.includes("head-count"))).toEqual([]);
    expect(db.queries.filter((q) => q.startsWith("game_participants"))).toEqual([]);
    view.unmount();
  });

  /** A fresh store module and an empty fake database, so a test sees only its own loads. */
  async function freshStore() {
    vi.resetModules();
    window.localStorage.clear();
    db.channels.length = 0;
    db.handlers.length = 0;
    db.queries.length = 0;
    db.subscribed.length = 0;
    db.auth.length = 0;
    db.hold = null;
    db.inFlight = 0;
    db.maxInFlight = 0;
    const { useHostedGames } = await import("@/lib/hosted-games-store");
    const { useLiveParticipantCount } = await import("@/lib/game-participants-store");
    const seen: (number | undefined)[] = [];
    function Card() {
      const n = useLiveParticipantCount("g-a");
      seen.push(n);
      return <span data-testid="g-a">{n === undefined ? "fallback" : n}</span>;
    }
    function Feed() {
      useHostedGames();
      return <Card />;
    }
    const loads = () => db.queries.filter((q) => q === "hosted_games").length;
    return { Feed, seen, loads };
  }

  it("stays live through a re-load after an auth event", async () => {
    const { Feed, seen, loads } = await freshStore();
    db.rows = [{ id: "g-a", joined: 2, max_players: 10 }];
    const view = render(<Feed />);
    await settle();
    expect(loads()).toBe(1);
    expect(view.getByTestId("g-a").textContent).toBe("2");

    // Every tab refocus emits SIGNED_IN: the store loads again. The count must not drop to the
    // card's own copy meanwhile, and must show the new value once the load is in.
    db.rows = [{ id: "g-a", joined: 5, max_players: 10 }];
    seen.length = 0;
    await act(async () => db.auth.forEach((cb) => cb("SIGNED_IN")));
    await settle();
    expect(loads()).toBe(2);
    expect(view.getByTestId("g-a").textContent).toBe("5");
    expect(seen).not.toContain(undefined);
    view.unmount();
  });

  it("catches up when the channel joins after the first load, and after a dropped connection", async () => {
    const { Feed, loads } = await freshStore();
    db.rows = [{ id: "g-a", joined: 2, max_players: 10 }];
    const view = render(<Feed />);
    await settle();
    expect(loads()).toBe(1);
    const channelStatus = db.subscribed.at(-1)!;

    // A join lands after the first load but before the channel is subscribed: no event carries it.
    db.rows = [{ id: "g-a", joined: 3, max_players: 10 }];
    await act(async () => channelStatus("SUBSCRIBED"));
    await settle();
    expect(loads()).toBe(2);
    expect(view.getByTestId("g-a").textContent).toBe("3");

    // The connection drops; a join happens meanwhile; the channel joins again.
    await act(async () => channelStatus("CHANNEL_ERROR"));
    db.rows = [{ id: "g-a", joined: 6, max_players: 10 }];
    expect(view.getByTestId("g-a").textContent).toBe("3");
    await act(async () => channelStatus("SUBSCRIBED"));
    await settle();
    expect(view.getByTestId("g-a").textContent).toBe("6");
    expect(db.channels).toEqual(["hosted_games:all"]);
    view.unmount();
  });

  it("runs catch-up loads one at a time, with one more run for joins that arrive meanwhile", async () => {
    const { Feed, loads } = await freshStore();
    db.rows = [{ id: "g-a", joined: 2, max_players: 10 }];
    const view = render(<Feed />);
    await settle();
    const channelStatus = db.subscribed.at(-1)!;
    const before = loads();

    let release = () => {};
    db.hold = new Promise<void>((r) => (release = r));
    await act(async () => {
      channelStatus("SUBSCRIBED");
      channelStatus("SUBSCRIBED");
      channelStatus("SUBSCRIBED");
    });
    expect(loads() - before).toBe(1);
    db.hold = null;
    release();
    await settle();
    // The three joins cost two loads, never two at once.
    expect(loads() - before).toBe(2);
    expect(db.maxInFlight).toBe(1);
    view.unmount();
  });

  it("reads the store without starting a load or a channel", () => {
    const src = readFileSync("src/lib/game-participants-store.ts", "utf8");
    expect(src).not.toMatch(/\.channel\(|\.from\(|count: "exact"/);
    const store = readFileSync("src/lib/hosted-games-store.ts", "utf8");
    const hook = store.slice(store.indexOf("export function useHostedGameJoined"));
    const body = hook.slice(0, hook.indexOf("\n}\n"));
    expect(body).not.toMatch(/ensureDbHydrated|ensureRealtime|getSnapshot\(\)/);
  });
});
