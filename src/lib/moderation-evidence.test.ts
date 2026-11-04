import { describe, expect, it, vi } from "vitest";
import { evidenceFields, latestOpenEvidenceByGame, type EvidenceRow } from "./location-hold";
import { loadHeldEvidence } from "./moderation.server";

/**
 * SEC-7 item 6: the moderation screen shows the held listing text (the latest OPEN automatic hold's evidence), so Restore text or
 * Confirm removal is decided with the text in view. Only a moderator's session reads it.
 */

const row = (over: Partial<EvidenceRow>): EvidenceRow => ({
  game_id: "g1",
  captured_at: "2026-11-01T10:00:00Z",
  captured_by: null,
  released_at: null,
  title: "U12 run",
  description: "Meet at 12 Oak St, side door",
  neighborhood: "Midtown",
  game_rules: null,
  equipment: [],
  cancellation_notes: null,
  cancellation_reason: null,
  ...over,
});

describe("held listing evidence", () => {
  it("picks the latest open automatic hold per game", () => {
    const map = latestOpenEvidenceByGame([
      row({ captured_at: "2026-11-01T10:00:00Z", description: "older" }),
      row({ captured_at: "2026-11-03T10:00:00Z", description: "newest" }),
      row({
        captured_at: "2026-11-04T10:00:00Z",
        description: "released",
        released_at: "2026-11-04T11:00:00Z",
      }),
      row({
        captured_at: "2026-11-05T10:00:00Z",
        description: "a moderator's own removal",
        captured_by: "m1",
      }),
      row({ game_id: "g2", description: "other game" }),
      row({ game_id: null, description: "post evidence" }),
    ]);
    expect(map.get("g1")?.description).toBe("newest");
    expect(map.get("g2")?.description).toBe("other game");
    expect(map.size).toBe(2);
  });

  it("lists the non-empty fields with labels", () => {
    const e = latestOpenEvidenceByGame([
      row({ equipment: ["ball", "water"], game_rules: "  " }),
    ]).get("g1")!;
    expect(evidenceFields(e)).toEqual([
      { label: "Title", value: "U12 run" },
      { label: "Description", value: "Meet at 12 Oak St, side door" },
      { label: "Neighborhood", value: "Midtown" },
      { label: "Equipment", value: "ball, water" },
    ]);
  });
});

function ctx(isModerator: boolean, rows: EvidenceRow[] = [row({})]) {
  const calls: { table?: string; filters: [string, string, unknown][] } = { filters: [] };
  const query: any = {
    select: (cols: string) => {
      calls.filters.push(["select", cols, null]);
      return query;
    },
    in: (col: string, v: unknown) => {
      calls.filters.push(["in", col, v]);
      return query;
    },
    is: (col: string, v: unknown) => {
      calls.filters.push(["is", col, v]);
      return query;
    },
    order: async () => ({ data: rows, error: null }),
  };
  const supabase = {
    rpc: vi.fn(async () => ({ data: isModerator, error: null })),
    from: vi.fn((table: string) => {
      calls.table = table;
      return query;
    }),
  };
  return { c: { supabase, userId: "u1" }, calls, supabase };
}

describe("loadHeldEvidence", () => {
  it("refuses anyone who is not a moderator before reading anything", async () => {
    const { c, supabase } = ctx(false);
    await expect(loadHeldEvidence(c, ["g1"])).rejects.toThrow("Forbidden");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("reads open automatic holds with the moderator's own session", async () => {
    const { c, calls } = ctx(true);
    const map = await loadHeldEvidence(c, ["g1"]);
    expect(calls.table).toBe("location_report_evidence");
    expect(calls.filters).toContainEqual(["in", "game_id", ["g1"]]);
    expect(calls.filters).toContainEqual(["is", "released_at", null]);
    expect(calls.filters).toContainEqual(["is", "captured_by", null]);
    expect(map.get("g1")?.title).toBe("U12 run");
  });

  it("reads nothing when no report on the page is held", async () => {
    const { c, supabase } = ctx(true);
    expect((await loadHeldEvidence(c, [])).size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
