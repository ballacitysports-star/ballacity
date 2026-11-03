import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  payee: "host-1" as string | null,
  rows: [] as Array<{
    host_id: string;
    requires_approval: boolean;
    created_at: string;
  }>,
  approvedRequest: false,
  inserted: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const settingsQuery = () => {
    let host: string | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (col: string, val: string) => {
        if (col === "host_id") host = val;
        return q;
      },
      order: () => q,
      limit: () => q,
      maybeSingle: () => {
        const mine = h.rows.filter((r) => host === null || r.host_id === host);
        mine.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return Promise.resolve({ data: mine[0] ?? null });
      },
    };
    return q;
  };
  const simple = (data: unknown) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data }),
    };
    return q;
  };
  return {
    supabaseAdmin: {
      rpc: () => Promise.resolve({ data: h.payee }),
      from: (t: string) => {
        if (t === "game_payment_settings") return settingsQuery();
        if (t === "hosted_games") return simple({ id: "g", cancelled_at: null });
        if (t === "join_requests") return simple(h.approvedRequest ? { id: "r" } : null);
        return {
          insert: (row: unknown) => {
            h.inserted.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
});

import { addPaidPlayerToRoster } from "./roster-on-payment.server";

beforeEach(() => {
  h.payee = "host-1";
  h.approvedRequest = false;
  h.inserted = [];
  h.rows = [
    {
      host_id: "host-1",
      requires_approval: true,
      created_at: "2030-01-01T00:00:00Z",
    },
    // a stranger's newer row that says "no approval needed"
    {
      host_id: "stranger",
      requires_approval: false,
      created_at: "2030-02-01T00:00:00Z",
    },
  ];
});

describe("roster placement after a verified payment", () => {
  it("believes the payee's settings, not the newest row", async () => {
    const r = await addPaidPlayerToRoster("g", "player");
    expect(r.added).toBe(false); // approval is required and there is no approved request
    expect(h.inserted).toEqual([]);
  });

  it("places the player once the host's own approval requirement is met", async () => {
    h.approvedRequest = true;
    const r = await addPaidPlayerToRoster("g", "player");
    expect(r.added).toBe(true);
  });

  it("with no payee there is no authoritative row: request-to-join applies", async () => {
    h.payee = null;
    const r = await addPaidPlayerToRoster("g", "player");
    expect(r.added).toBe(false);
  });
});
