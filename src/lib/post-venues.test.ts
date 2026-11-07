import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  POST_VENUE_FIELDS,
  TEAM_POST_PUBLIC_COLUMNS,
  fetchPostVenues,
  mergeVenues,
  withVenues,
} from "./post-venues";

const venueRow = (id: string) => ({
  id,
  location: "Field 4",
  formatted_address: "1 Main St",
  place_id: "p1",
  lat: "40.7",
  lng: "-74.0",
});

describe("post venues (D0)", () => {
  it("never selects a venue column directly", () => {
    const cols = TEAM_POST_PUBLIC_COLUMNS.split(",");
    for (const f of POST_VENUE_FIELDS) expect(cols).not.toContain(f);
    expect(cols).toContain("id");
    expect(cols).toContain("event_date");
  });

  it("selects every other column the migration's grant covers", () => {
    const sql = readFileSync(
      "supabase/migrations/20261106210000_youth_post_venue_privacy.sql",
      "utf8",
    );
    expect(sql).toContain(
      "column_name NOT IN ('location', 'formatted_address', 'place_id', 'lat', 'lng')",
    );
  });

  it("asks the database once, de-duplicated, and parses coordinates", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [venueRow("a")], error: null });
    const venues = await fetchPostVenues({ rpc }, ["a", "a", "b", ""]);
    expect(rpc).toHaveBeenCalledWith("team_post_venues", { _ids: ["a", "b"] });
    expect(venues.get("a")).toEqual({
      location: "Field 4",
      formatted_address: "1 Main St",
      place_id: "p1",
      lat: 40.7,
      lng: -74,
    });
    expect(venues.has("b")).toBe(false);
  });

  it("asks nothing for no posts", async () => {
    const rpc = vi.fn();
    expect((await fetchPostVenues({ rpc }, [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed: a failed lookup shows no venue", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const rows = await withVenues({ rpc }, [{ id: "a" }]);
    expect(rows[0]).toMatchObject({ location: null, lat: null, venue_hidden: true });
  });

  it("marks posts the caller may not locate as hidden and fills the rest", () => {
    const venues = new Map([["a", { ...venueRow("a"), lat: 1, lng: 2 }]]);
    const merged = mergeVenues(
      [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      venues,
    );
    expect(merged[0]).toMatchObject({ title: "A", location: "Field 4", venue_hidden: false });
    expect(merged[1]).toMatchObject({ title: "B", location: null, venue_hidden: true });
  });

  it("no client-side read of team_posts selects a venue column or every column", () => {
    for (const file of [
      "src/lib/team-posts.functions.ts",
      "src/lib/tryouts.functions.ts",
      "src/routes/teams.$teamId.events.tsx",
      "src/components/team/manage/DashboardTab.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      // Every team_posts read through a client role: the select that follows .from("team_posts").
      const selects = [...src.matchAll(/\.from\("team_posts"[^)]*\)\s*\.select\(([^)]*)\)/g)]
        .filter((m) => !src.slice(Math.max(0, m.index! - 80), m.index!).includes("supabaseAdmin"))
        .map((m) => m[1]);
      for (const sel of selects) {
        expect(sel, `${file}: ${sel}`).not.toMatch(
          /"\*|location|formatted_address|place_id|\blat\b|\blng\b/,
        );
      }
    }
  });
});
