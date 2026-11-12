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
}));

vi.mock("@/integrations/supabase/client", () => {
  const roster = () => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => {
        db.loads += 1;
        const visible = db.member ? db.rows : db.rows.filter((r) => r.user_id === db.me);
        return Promise.resolve({ data: visible, error: null });
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
      channel: () => {
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
});
