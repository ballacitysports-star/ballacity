import { describe, expect, it, vi } from "vitest";

/**
 * A Find Players page keeps the server's order (nearest or soonest), carries the measured distance and window, and
 * skips a post that disappeared between the search and the read.
 */
const server = vi.hoisted(() => ({
  page: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) =>
      Promise.resolve(
        fn === "players_available_near"
          ? { data: server.page, error: null }
          : { data: [{ id: "u1", age: 30 }], error: null },
      ),
    from: (table: string) => ({
      select: () => ({
        in: async () =>
          table === "profiles"
            ? { data: [{ id: "u1", display_name: "Jordan" }], error: null }
            : { data: server.rows, error: null },
      }),
    }),
  },
}));

const { listAvailabilityNear } = await import("./availability");

const row = (id: string, user: string) => ({
  id,
  user_id: user,
  sports: ["Basketball"],
  looking_for: [],
});

describe("listAvailabilityNear", () => {
  it("keeps the server's order, adds the author and the measurements", async () => {
    server.page = [
      {
        availability_id: "b",
        user_id: "u1",
        distance_mi: 1,
        window_start: "2026-11-18T23:00:00Z",
        window_end: "x",
        looking_for: [],
      },
      {
        availability_id: "a",
        user_id: "u2",
        distance_mi: null,
        window_start: null,
        window_end: null,
        looking_for: [],
      },
    ];
    // The table read returns rows in a different order.
    server.rows = [row("a", "u2"), row("b", "u1")];
    const out = await listAvailabilityNear({ lat: 34.12, lng: -84 });
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out[0]).toMatchObject({ author_name: "Jordan", author_age: 30, distance_mi: 1 });
    expect(out[1]).toMatchObject({ author_name: "Player", distance_mi: null, window_start: null });
  });

  it("skips a post that vanished between the search and the read", async () => {
    server.page = [
      {
        availability_id: "gone",
        user_id: "u3",
        distance_mi: 2,
        window_start: null,
        window_end: null,
        looking_for: [],
      },
      {
        availability_id: "b",
        user_id: "u1",
        distance_mi: 1,
        window_start: null,
        window_end: null,
        looking_for: [],
      },
    ];
    server.rows = [row("b", "u1")];
    expect((await listAvailabilityNear({})).map((r) => r.id)).toEqual(["b"]);
  });

  it("an empty page makes no further reads", async () => {
    server.page = [];
    expect(await listAvailabilityNear({})).toEqual([]);
  });
});
