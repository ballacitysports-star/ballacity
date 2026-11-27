// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

/**
 * useGameWaitlist applies realtime changes as deltas on top of a loaded list. A change made after the load on mount
 * read the list but before the change stream was live would be missing for good, so the hook opens its channel with
 * wait (SUBSCRIBED only once changes flow) and loads the list again on every SUBSCRIBED. Loads can overlap, so the
 * newest one sent must win.
 */

type StatusHandler = (status: string, err?: Error) => void;

const db = vi.hoisted(() => ({
  // Every waitlist load, numbered from 1, answers what this returns, when it resolves.
  answer: null as null | ((n: number) => Promise<unknown[]>),
  loads: 0,
  opened: [] as { name: string; options: unknown }[],
  status: undefined as StatusHandler | undefined,
  inserts: [] as ((p: { new: unknown }) => void)[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      db.loads += 1;
      const n = db.loads;
      return Promise.resolve(db.answer ? db.answer(n) : [])
        .then((data) => ({ data, error: null }))
        .then(resolve, reject);
    };
    return q;
  };
  return {
    supabase: {
      from: query,
      channel: (name: string, options?: unknown) => {
        db.opened.push({ name, options });
        const ch: Record<string, unknown> = {};
        ch.on = (_type: string, filter: { event: string }, cb: (p: { new: unknown }) => void) => {
          if (filter.event === "INSERT") db.inserts.push(cb);
          return ch;
        };
        ch.subscribe = (cb?: StatusHandler) => {
          db.status = cb;
          return ch;
        };
        return ch;
      },
      removeChannel: () => {},
    },
  };
});
vi.mock("@/lib/current-user-id", () => ({ getCurrentUserId: async () => "u1" }));

import { useGameWaitlist } from "./waitlist-store";

const row = (id: string) => ({
  id,
  game_id: "g1",
  position: "PG",
  user_id: `user-${id}`,
  created_at: "2026-11-27T00:00:00Z",
  status: "waiting",
  reviewed_at: null,
});

afterEach(() => {
  cleanup();
  db.answer = null;
  db.loads = 0;
  db.opened = [];
  db.status = undefined;
  db.inserts = [];
});

describe("useGameWaitlist realtime catch-up", () => {
  it("opens its channel holding SUBSCRIBED until the server streams the changes", () => {
    renderHook(() => useGameWaitlist("g1"));
    // game_position_waitlist is in the supabase_realtime publication, so a join that waits is accepted.
    expect(db.opened).toStrictEqual([
      {
        name: "game_position_waitlist:g1",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
  });

  it("loads the whole list again on every SUBSCRIBED, and not on other statuses", async () => {
    db.answer = async (n) => (n === 1 ? [row("a")] : [row("a"), row("b")]);
    const { result } = renderHook(() => useGameWaitlist("g1"));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.loading).toBe(false);

    // Someone joined after the load on mount read the list, before the change stream was live: no INSERT came.
    await act(async () => db.status!("SUBSCRIBED"));
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]));
    expect(db.loads).toBe(2);

    await act(async () => db.status!("CHANNEL_ERROR"));
    expect(db.loads).toBe(2);

    // A rejoin after a drop: changes made while it was down are not replayed.
    await act(async () => db.status!("SUBSCRIBED"));
    await waitFor(() => expect(db.loads).toBe(3));
  });

  it("an older load answering last does not replace a newer one", async () => {
    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((r) => {
      releaseFirst = r;
    });
    db.answer = async (n) => {
      if (n === 1) {
        await firstHeld;
        return [row("a")];
      }
      return [row("a"), row("b")];
    };
    const { result } = renderHook(() => useGameWaitlist("g1"));
    await waitFor(() => expect(db.loads).toBe(1));
    await act(async () => db.status!("SUBSCRIBED"));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => {
      releaseFirst();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("still applies an INSERT delta on top of the loaded list", async () => {
    db.answer = async () => [row("a")];
    const { result } = renderHook(() => useGameWaitlist("g1"));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(async () => db.inserts.forEach((h) => h({ new: row("c") })));
    expect(result.current.entries.map((e) => e.id)).toEqual(["a", "c"]);
  });
});
