// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * game_participants is readable only by the host and the game's own players, so a viewer who is
 * neither loads an empty roster. Once the viewer takes a place during the visit, their own row
 * arrives in real time and the rest of the roster becomes readable: the hook loads it again.
 */

type Handler = (payload: { new?: unknown; old?: unknown }) => void;
const db = vi.hoisted(() => ({
  rows: [] as { user_id: string; created_at: string; position: null }[],
  member: false,
  loads: 0,
  me: "viewer",
  inserts: [] as ((payload: { new?: unknown }) => void)[],
  status: null as null | ((s: string) => void),
  opened: [] as { name: string; options: unknown }[],
  // When set, a roster load waits for it, and answers with the roster as it was when the load was sent.
  gate: null as Promise<void> | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const roster = () => {
    const b = {
      select: () => b,
      eq: () => b,
      order: async () => {
        db.loads += 1;
        const visible = db.member ? [...db.rows] : db.rows.filter((r) => r.user_id === db.me);
        if (db.gate) await db.gate;
        return { data: visible, error: null };
      },
    };
    return b;
  };
  const profiles = () => {
    const b = { select: () => b, in: () => Promise.resolve({ data: [], error: null }) };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => (table === "game_participants" ? roster() : profiles()),
      channel: (name: string, options?: unknown) => {
        db.opened.push({ name, options });
        const ch = {
          on: (_t: string, opts: { event: string }, handler: Handler) => {
            if (opts.event === "INSERT") db.inserts.push(handler);
            return ch;
          },
          subscribe: (cb: (s: string) => void) => {
            db.status = cb;
            return ch;
          },
        };
        return ch;
      },
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: { user: { id: db.me } } } }) },
    },
  };
});

import { useLiveParticipants } from "./game-roster";

const row = (user_id: string) => ({ user_id, created_at: "2026-11-11T00:00:00Z", position: null });

describe("useLiveParticipants", () => {
  it("loads the whole roster again once the viewer's own place arrives", async () => {
    db.rows = [row("p1"), row("p2"), row("p3")];
    db.member = false;
    const { result } = renderHook(() => useLiveParticipants("g1"));
    await act(async () => db.status?.("SUBSCRIBED"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.participants).toHaveLength(0); // a stranger reads nothing
    const loadsBefore = db.loads;

    // Someone else joins: delivered as one row, no reload needed.
    db.rows.push(row("p4"));
    await act(async () => db.inserts.forEach((h) => h({ new: row("p4") })));
    expect(db.loads).toBe(loadsBefore);

    // The viewer joins: their row arrives, and now the whole roster is readable.
    db.rows.push(row("viewer"));
    db.member = true;
    await act(async () => db.inserts.forEach((h) => h({ new: row("viewer") })));
    await waitFor(() => expect(result.current.participants).toHaveLength(5));
    expect(db.loads).toBe(loadsBefore + 1);
  });

  it("opens its channel holding SUBSCRIBED until the server streams the changes", () => {
    db.opened = [];
    renderHook(() => useLiveParticipants("g2"));
    // The reload on SUBSCRIBED is what catches changes made before the subscription; it only does if it is live.
    expect(db.opened).toEqual([
      {
        name: "game_participants:roster:g2",
        options: { config: { postgres_changes_options: { wait: true } } },
      },
    ]);
  });

  describe("loading without waiting for the channel", () => {
    const status = (s: string) => act(async () => db.status?.(s));

    it("shows the roster before the channel reports anything", async () => {
      db.rows = [row("p1"), row("p2")];
      db.member = true;
      db.gate = null;
      db.loads = 0;
      const { result } = renderHook(() => useLiveParticipants("g3"));
      // With wait, SUBSCRIBED comes only once the server streams the changes, which can take seconds.
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.participants.map((p) => p.userId)).toEqual(["p1", "p2"]);
      expect(db.loads).toBe(1);
    });

    it.each(["CHANNEL_ERROR", "TIMED_OUT"])(
      "keeps the roster through %s, and reloads when a rejoin succeeds",
      async (failure) => {
        db.rows = [row("p1")];
        db.member = true;
        db.gate = null;
        db.loads = 0;
        const { result } = renderHook(() => useLiveParticipants("g4"));
        await waitFor(() => expect(result.current.participants).toHaveLength(1));
        // A server that cannot set up the change stream refuses a join that waits for it.
        await status(failure);
        expect(result.current.participants).toHaveLength(1);
        expect(db.loads).toBe(1);
        db.rows.push(row("p2"));
        await status("SUBSCRIBED");
        await waitFor(() => expect(result.current.participants).toHaveLength(2));
        expect(db.loads).toBe(2);
      },
    );
  });

  it("does not let an older load, answering last, replace a newer one", async () => {
    db.rows = [row("p1")];
    db.member = true;
    let release!: () => void;
    db.gate = new Promise<void>((r) => (release = r));
    const gate = db.gate;
    const { result } = renderHook(() => useLiveParticipants("g5"));
    // The first join's reload is slow; the connection drops and the rejoin's reload answers first.
    await act(async () => db.status?.("SUBSCRIBED"));
    db.gate = null;
    db.rows.push(row("p2"));
    await act(async () => db.status?.("SUBSCRIBED"));
    await waitFor(() => expect(result.current.participants).toHaveLength(2));
    await act(async () => {
      release();
      await gate;
    });
    await act(async () => new Promise<void>((r) => setTimeout(r, 0)));
    expect(result.current.participants.map((p) => p.userId)).toEqual(["p1", "p2"]);
  });
});
