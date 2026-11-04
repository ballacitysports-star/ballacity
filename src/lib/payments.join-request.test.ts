import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; payload?: unknown; filters: Record<string, unknown> }[],
  insertError: null as unknown,
  readRow: null as unknown,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call = {
      table,
      op: "select",
      payload: undefined as unknown,
      filters: {} as Record<string, unknown>,
    };
    h.calls.push(call);
    const chain: any = {
      insert: (payload: unknown) => {
        call.op = "insert";
        call.payload = payload;
        return Promise.resolve({ error: h.insertError });
      },
      select: () => chain,
      eq: (k: string, v: unknown) => ((call.filters[k] = v), chain),
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: h.readRow, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
    };
    return chain;
  };
  return {
    supabase: {
      from,
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "player" } } }) },
    },
  };
});
vi.mock("@/lib/guardian-push.functions", () => ({ pingGuardians: () => undefined }));

beforeEach(() => {
  h.calls = [];
  h.insertError = null;
  h.readRow = {
    id: "r1",
    game_id: "g1",
    player_id: "player",
    host_id: null,
    viewer_is_host: false,
    status: "pending",
  };
});

describe("join requests never need the host's account id (SEC-5)", () => {
  it("inserts without host_id and reads the row back through join_requests_visible", async () => {
    const { createJoinRequest } = await import("./payments");
    const req = await createJoinRequest({ game_id: "g1", host_id: "ignored-host" });
    const insert = h.calls.find((c) => c.op === "insert")!;
    expect(insert.table).toBe("join_requests");
    expect(insert.payload).not.toHaveProperty("host_id");
    const read = h.calls.find((c) => c.op === "select")!;
    expect(read.table).toBe("join_requests_visible");
    expect(req.host_id).toBeNull();
  });

  it("lists requests for my games by viewer_is_host, not by host_id", async () => {
    const { listHostJoinRequests } = await import("./payments");
    await listHostJoinRequests();
    const call = h.calls.at(-1)!;
    expect(call.table).toBe("join_requests_visible");
    expect(call.filters).toEqual({ viewer_is_host: true });
  });
});
