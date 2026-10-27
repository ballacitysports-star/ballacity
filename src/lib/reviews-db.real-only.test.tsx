// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * Reviews drive trust scores, so a review has to be a real person's. The review
 * hooks used to merge a built-in set of invented reviews (from "Riley Chen",
 * "Devon Wright"...) into every member's own profile and into the public review
 * board. Only reviews from the database may show.
 */

const rows: Record<string, unknown[]> = { reviews: [], profiles: [] };

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "neq", "in", "or", "order", "limit", "is", "not"])
    chain[m] = self;
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows[table] ?? [], error: null });
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t), rpc: async () => ({ data: [], error: null }) },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "member-1" } }) }));
vi.mock("@/lib/reviews.functions", () => ({
  analyzeSubmittedReview: vi.fn(),
  submitReview: vi.fn(),
}));

const { useReviewBoard, useReviewsFor } = await import("./reviews-db");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("review hooks", () => {
  it("show a member with no reviews none, not invented ones", async () => {
    const { result } = renderHook(() => useReviewsFor("me"), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toEqual([]);
  });

  it("leave the review board empty when the database has no reviews", async () => {
    const { result } = renderHook(() => useReviewBoard(), { wrapper });
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
