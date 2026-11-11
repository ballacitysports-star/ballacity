import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  fetchRegistrationCounts,
  getTryoutFromEvents,
  isEventsV2Enabled,
  listTeamEventsFromEvents,
  parseEventsV2Setting,
  toTeamEventRow,
  type CopiedEvent,
  type EventsClient,
} from "./events-read";

type Result = { data: unknown; error: { message: string } | null };

/** A fake Supabase client: each table or RPC returns a canned result; calls are recorded. */
function fakeClient(
  tables: Record<string, Result>,
  rpcs: Record<string, Result> = {},
  calls: string[] = [],
): EventsClient {
  const builder = (table: string) => {
    const result = tables[table] ?? { data: [], error: null };
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push(`${table}.${name}(${JSON.stringify(args)})`);
        return b;
      };
    for (const m of ["select", "eq", "in", "not", "order"]) b[m] = chain(m);
    b.maybeSingle = () => Promise.resolve(result);
    b.then = (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, bad);
    return b as unknown as ReturnType<EventsClient["from"]>;
  };
  return {
    from: (t: string) => builder(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc.${fn}(${JSON.stringify(args)})`);
      return Promise.resolve(rpcs[fn] ?? { data: [], error: null });
    },
  };
}

const ev = (over: Partial<CopiedEvent> = {}): CopiedEvent => ({
  id: "e1",
  legacy_post_id: "p1",
  kind: "tryout",
  title: "U12 tryout",
  body: null,
  starts_at: "2026-12-01T17:00:00Z",
  price_cents: 1500,
  capacity: 20,
  ...over,
});

describe("events_v2 switch", () => {
  it("is on only for {enabled: true}", () => {
    expect(parseEventsV2Setting({ enabled: true })).toBe(true);
    for (const v of [{ enabled: false }, { enabled: "true" }, {}, null, undefined, true, "on"]) {
      expect(parseEventsV2Setting(v)).toBe(false);
    }
  });

  it("reads off when the row is missing, unreadable or the query throws", async () => {
    expect(await isEventsV2Enabled(fakeClient({ app_settings: { data: null, error: null } }))).toBe(
      false,
    );
    expect(
      await isEventsV2Enabled(
        fakeClient({ app_settings: { data: null, error: { message: "denied" } } }),
      ),
    ).toBe(false);
    const throwing = {
      from: () => {
        throw new Error("boom");
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    expect(await isEventsV2Enabled(throwing as unknown as EventsClient)).toBe(false);
    expect(
      await isEventsV2Enabled(
        fakeClient({ app_settings: { data: { value: { enabled: true } }, error: null } }),
      ),
    ).toBe(true);
  });
});

describe("toTeamEventRow", () => {
  it("keys the row by the original post, in dollars, with seats from registrations", () => {
    const row = toTeamEventRow(ev(), 3, {
      event_id: "e1",
      place_id: "pl",
      formatted_address: "1 Main St",
      lat: 40.1,
      lng: -73.9,
    });
    expect(row).toMatchObject({
      id: "p1",
      kind: "tryout",
      event_date: "2026-12-01T17:00:00Z",
      price: 15,
      spots_max: 20,
      spots_taken: 3,
      location: "1 Main St",
      formatted_address: "1 Main St",
      lat: 40.1,
      venue_hidden: false,
    });
  });

  it("hides the venue when no location came back for the caller", () => {
    const row = toTeamEventRow(ev(), 0, undefined);
    expect(row?.venue_hidden).toBe(true);
    expect(row?.location).toBeNull();
  });

  it("skips events that did not come from a post, and kinds the page does not show", () => {
    expect(toTeamEventRow(ev({ legacy_post_id: null }), 0, undefined)).toBeNull();
    expect(toTeamEventRow(ev({ kind: "camp" }), 0, undefined)).toBeNull();
  });

  it("keeps a free event free and an unpriced one unpriced", () => {
    expect(toTeamEventRow(ev({ price_cents: 0 }), 0, undefined)?.price).toBe(0);
    expect(toTeamEventRow(ev({ price_cents: null }), 0, undefined)?.price).toBeNull();
  });
});

describe("listTeamEventsFromEvents", () => {
  it("reads only copied tryouts and clinics of the team, and counts registered seats", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      {
        events: {
          data: [ev(), ev({ id: "e2", legacy_post_id: "p2", kind: "clinic" })],
          error: null,
        },
      },
      {
        get_event_registration_counts: {
          data: [
            { event_id: "e1", registered: 2 },
            { event_id: "e2", registered: 1 },
          ],
          error: null,
        },
        get_event_locations: {
          data: [
            { event_id: "e2", place_id: null, formatted_address: "Gym", lat: null, lng: null },
          ],
          error: null,
        },
      },
      calls,
    );
    const rows = await listTeamEventsFromEvents(client, "hawks");
    expect(rows.map((r) => [r.id, r.spots_taken, r.venue_hidden])).toEqual([
      ["p1", 2, true],
      ["p2", 1, false],
    ]);
    expect(calls).toContain('events.eq(["team_id","hawks"])');
    expect(calls).toContain('events.not(["legacy_post_id","is",null])');
    // Seats are counted by the function, never by reading registrations (members see only their own).
    expect(calls).toContain('rpc.get_event_registration_counts({"_ids":["e1","e2"]})');
    expect(calls.some((c) => c.startsWith("event_registrations."))).toBe(false);
  });

  it("fails closed on venues: a failed lookup hides every venue", async () => {
    const client = fakeClient(
      { events: { data: [ev()], error: null } },
      { get_event_locations: { data: null, error: { message: "nope" } } },
    );
    const [row] = await listTeamEventsFromEvents(client, "hawks");
    expect(row.venue_hidden).toBe(true);
  });

  it("throws on a read error so the page can fall back to team_posts", async () => {
    await expect(
      listTeamEventsFromEvents(
        fakeClient({ events: { data: null, error: { message: "denied" } } }),
        "hawks",
      ),
    ).rejects.toThrow("denied");
  });

  it("returns nothing (and asks for nothing more) when the team has no events", async () => {
    const calls: string[] = [];
    expect(
      await listTeamEventsFromEvents(
        fakeClient({ events: { data: [], error: null } }, {}, calls),
        "x",
      ),
    ).toEqual([]);
    expect(calls.some((c) => c.startsWith("rpc."))).toBe(false);
  });
});

describe("fetchRegistrationCounts", () => {
  it("maps counts by event and asks for nothing when there are no ids", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      {},
      { get_event_registration_counts: { data: [{ event_id: "e1", registered: 3 }], error: null } },
      calls,
    );
    expect(await fetchRegistrationCounts(client, [])).toEqual(new Map());
    expect(calls).toEqual([]);
    expect(await fetchRegistrationCounts(client, ["e1", "e2"])).toEqual(new Map([["e1", 3]]));
  });

  it("throws on error so the caller falls back", async () => {
    const client = fakeClient(
      {},
      { get_event_registration_counts: { data: null, error: { message: "denied" } } },
    );
    await expect(fetchRegistrationCounts(client, ["e1"])).rejects.toThrow("denied");
  });
});

describe("getTryoutFromEvents", () => {
  const tryoutRow = {
    ...ev(),
    cancel_cutoff_min: 120,
    refund_rule: null,
    late_refund_pct: 50,
    team_id: "hawks",
    teams: { name: "Hawks", avatar: null, sports: ["soccer"] },
  };

  it("maps the copy to the page's listing, keyed by the post, with seats and venue from the viewer", async () => {
    const publicCalls: string[] = [];
    const viewerCalls: string[] = [];
    const pub = fakeClient({ events: { data: tryoutRow, error: null } }, {}, publicCalls);
    const viewer = fakeClient(
      {},
      {
        get_event_registration_counts: { data: [{ event_id: "e1", registered: 4 }], error: null },
        get_event_location: {
          data: [{ place_id: null, formatted_address: "City Gym", lat: null, lng: null }],
          error: null,
        },
      },
      viewerCalls,
    );
    const t = await getTryoutFromEvents(pub, viewer, "p1");
    expect(t).toMatchObject({
      id: "p1",
      kind: "tryout",
      price: 15,
      spotsMax: 20,
      spotsTaken: 4,
      location: "City Gym",
      venueHidden: false,
      cancelCutoffMin: 120,
      refundRule: "until_cutoff",
      lateRefundPct: 50,
      teamId: "hawks",
      teamName: "Hawks",
      sports: ["soccer"],
    });
    expect(publicCalls).toContain('events.eq(["legacy_post_id","p1"])');
    expect(viewerCalls).toContain('rpc.get_event_location({"_event":"e1"})');
  });

  it("returns null when there is no visible copy, so the page reads team_posts", async () => {
    const pub = fakeClient({ events: { data: null, error: null } });
    expect(await getTryoutFromEvents(pub, fakeClient({}), "p1")).toBeNull();
  });

  it("hides the venue when the lookup fails or returns nothing", async () => {
    const pub = fakeClient({ events: { data: tryoutRow, error: null } });
    for (const loc of [
      { data: null, error: { message: "nope" } },
      { data: [], error: null },
    ]) {
      const viewer = fakeClient({}, { get_event_location: loc });
      const t = await getTryoutFromEvents(pub, viewer, "p1");
      expect(t?.venueHidden).toBe(true);
      expect(t?.location).toBeNull();
    }
  });

  it("throws on a read error", async () => {
    const pub = fakeClient({ events: { data: null, error: { message: "denied" } } });
    await expect(getTryoutFromEvents(pub, fakeClient({}), "p1")).rejects.toThrow("denied");
  });
});

describe("tryout page", () => {
  it("reads events only behind the switch, and falls back to team_posts", () => {
    const src = readFileSync("src/lib/tryouts.functions.ts", "utf8");
    const fnAt = src.indexOf("export const getTryout = ");
    const body = src.slice(fnAt, src.indexOf("export const", fnAt + 10));
    const flagAt = body.indexOf("isEventsV2Enabled(");
    const v2At = body.indexOf("getTryoutFromEvents(");
    const legacyAt = body.indexOf('.from("team_posts")');
    expect(flagAt).toBeGreaterThan(-1);
    expect(v2At).toBeGreaterThan(flagAt);
    expect(legacyAt).toBeGreaterThan(v2At);
    expect(body).toMatch(/if \(v2\) return/);
    expect(body).toMatch(/catch \(err\)[\s\S]*?using team_posts/);
  });
});

describe("team events page", () => {
  it("reads events only behind the switch, and falls back to team_posts", () => {
    const src = readFileSync("src/routes/teams.$teamId.events.tsx", "utf8");
    const flagAt = src.indexOf("isEventsV2Enabled(");
    const v2At = src.indexOf("listTeamEventsFromEvents(");
    const legacyAt = src.indexOf('.from("team_posts")');
    expect(flagAt).toBeGreaterThan(-1);
    expect(v2At).toBeGreaterThan(flagAt);
    expect(legacyAt).toBeGreaterThan(v2At);
    expect(src).toMatch(/catch \(err\)[\s\S]*?using team_posts/);
  });
});
