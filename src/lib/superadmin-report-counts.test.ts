/**
 * The superadmin Overview and AttentionStrip count reports nobody has picked up yet. New reports are written with
 * status "new" (submitReport in moderation.ts), and older rows may still say "pending" or "open". Both counts must use
 * the moderation queue's "New" filter, or a fresh report is invisible on the control center.
 *
 * These run the real server functions against a small in-memory database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return (arg: { data: unknown; context: unknown }) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/reels-pipeline.server", () => ({ MAX_ATTEMPTS: 3, STUCK_AFTER_MS: 600_000 }));

vi.mock("@/integrations/supabase/client.server", () => {
  // Enough of PostgREST for countRows and the Overview's recent-activity reads.
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const q = {
      select: () => q,
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return q;
      },
      in(c: string, vs: readonly unknown[]) {
        filters.push((r) => vs.includes(r[c]));
        return q;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return q;
      },
      not(c: string, op: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) !== v);
        return q;
      },
      gte: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      then(resolve: (v: unknown) => unknown) {
        const rows = (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return resolve({ data: rows, count: rows.length, error: null });
      },
    };
    return q;
  };
  return { supabaseAdmin: { from: query } };
});

import { superadminOverview } from "./superadmin.functions";
import { superadminAttention } from "./superadmin-attention.functions";

const context = {
  userId: "22222222-2222-4222-8222-222222222222",
  supabase: { rpc: async () => ({ data: true, error: null }) },
};
type Run<T> = (arg: { data: unknown; context: unknown }) => Promise<T>;
const overview = () =>
  (superadminOverview as unknown as Run<{ counts: Record<string, number> }>)({
    data: {},
    context,
  });
const attention = () =>
  (superadminAttention as unknown as Run<Record<string, number>>)({ data: {}, context });

const reports = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe("open report counts on the control center", () => {
  beforeEach(() => {
    h.tables = {};
  });

  it("counts a report filed as new on the Overview", async () => {
    h.tables.user_reports = reports("new");
    const { counts } = await overview();
    expect(counts.reports).toBe(1);
    expect(counts.openReports).toBe(1);
  });

  it("counts new, pending and open, and nothing that is being handled or closed", async () => {
    h.tables.user_reports = reports(
      "new",
      "pending",
      "open",
      "investigating",
      "reviewing",
      "resolved",
      "actioned",
      "dismissed",
      "escalated",
    );
    const { counts } = await overview();
    expect(counts.reports).toBe(9);
    expect(counts.openReports).toBe(3);
    expect((await attention()).newReports).toBe(3);
  });

  it("shows a report filed as new in AttentionStrip", async () => {
    h.tables.user_reports = reports("new", "resolved");
    expect((await attention()).newReports).toBe(1);
  });
});

describe("availability posts on the Overview", () => {
  beforeEach(() => {
    h.tables = {};
  });

  it("shows open posts next to the all-time total, leaving out hidden ones", async () => {
    h.tables.player_availabilities = [
      { status: "open", hidden_at: null },
      { status: "open", hidden_at: null },
      { status: "open", hidden_at: "2026-11-20T00:00:00Z" },
      { status: "paused", hidden_at: null },
      { status: "expired", hidden_at: null },
      { status: "closed", hidden_at: null },
    ];
    const { counts } = await overview();
    expect(counts.availability).toBe(6);
    expect(counts.openAvailability).toBe(2);
  });
});
