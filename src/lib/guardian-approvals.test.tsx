// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * A minor's game request needs the host's answer and the guardian's, in either
 * order. The Parent Center used to list only requests still waiting on the host,
 * so a host who answered first hid the request from the guardian for good.
 */

const requestFilters: { column: string; values: unknown[] }[] = [];

const rows = {
  join_requests: [
    {
      id: "r-waiting",
      game_id: "g1",
      player_id: "kid",
      message: null,
      created_at: "2026-10-26T10:00:00Z",
      status: "pending",
    },
    {
      id: "r-host-yes",
      game_id: "g1",
      player_id: "kid",
      message: null,
      created_at: "2026-10-26T11:00:00Z",
      status: "approved",
    },
  ],
  team_invites: [],
  teams: [],
  hosted_games: [{ id: "g1", title: "Pickup", date: "2026-10-30T18:00:00Z" }],
} as Record<string, unknown[]>;

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.is = self;
  chain.gt = self;
  chain.order = self;
  chain.eq = self;
  chain.in = (column: string, values: unknown[]) => {
    if (table === "join_requests") requestFilters.push({ column, values });
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows[table] ?? [], error: null });
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t) },
}));
vi.mock("@/lib/child-safety", () => ({
  useMyChildren: () => ({
    children: [{ childUserId: "kid", displayName: "Kid" }],
    isLoading: false,
  }),
}));

const { guardianApprovalError, useGuardianApprovals } = await import("./guardian-approvals");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useGuardianApprovals", () => {
  it("lists requests the host already approved, and says so", async () => {
    const { result } = renderHook(() => useGuardianApprovals(), { wrapper });
    await waitFor(() => expect(result.current.requests).toHaveLength(2));
    const statuses = requestFilters.find((f) => f.column === "status");
    expect(statuses?.values).toEqual(["pending", "approved"]);
    expect(result.current.requests.map((r) => [r.id, r.hostApproved])).toEqual([
      ["r-waiting", false],
      ["r-host-yes", true],
    ]);
  });
});

describe("guardianApprovalError", () => {
  it("explains a child who is already in the game", () => {
    expect(guardianApprovalError(new Error("ALREADY_ON_ROSTER: this child is already in"))).toMatch(
      /already in this game/i,
    );
  });
});
