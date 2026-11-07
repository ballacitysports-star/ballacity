import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  kindsForFeedType,
  listFeedEvents,
  parseFeedType,
  type FeedEventsClient,
} from "./feed-events";

type Result = { data: unknown; error: { message: string } | null };

function fake(
  events: Result,
  rpcs: Record<string, Result> = {},
  calls: string[] = [],
): FeedEventsClient {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "in", "or", "order", "limit"])
    q[m] = (...a: unknown[]) => {
      calls.push(`${m}(${JSON.stringify(a)})`);
      return q;
    };
  q.then = (ok: (r: Result) => unknown) => Promise.resolve(events).then(ok);
  return {
    from: (t: string) => {
      calls.push(`from(${t})`);
      return q as unknown as ReturnType<FeedEventsClient["from"]>;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc.${fn}(${JSON.stringify(args)})`);
      return Promise.resolve(rpcs[fn] ?? { data: [], error: null });
    },
  };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  legacy_post_id: `p-${id}`,
  kind: "tryout",
  title: `Tryout ${id}`,
  starts_at: "2026-12-01T17:00:00Z",
  price_cents: 1500,
  capacity: 10,
  team_id: "hawks",
  teams: { name: "Hawks", sports: ["soccer"] },
  ...over,
});

describe("feed types", () => {
  it("parses the URL value, defaulting to All", () => {
    expect(parseFeedType("tryouts")).toBe("tryouts");
    expect(parseFeedType("nonsense")).toBe("all");
    expect(parseFeedType(undefined)).toBe("all");
  });
  it("maps types to event kinds; Pickup has none", () => {
    expect(kindsForFeedType("all")).toEqual(["tryout", "clinic"]);
    expect(kindsForFeedType("tryouts")).toEqual(["tryout"]);
    expect(kindsForFeedType("clinics")).toEqual(["clinic"]);
    expect(kindsForFeedType("pickup")).toEqual([]);
  });
});

describe("listFeedEvents", () => {
  it("reads upcoming or undated events of the kinds, soonest first, with true seats and allowed venues", async () => {
    const calls: string[] = [];
    const client = fake(
      { data: [row("e1"), row("e2", { kind: "tryout" })], error: null },
      {
        get_event_registration_counts: { data: [{ event_id: "e1", registered: 4 }], error: null },
        get_event_locations: {
          data: [{ event_id: "e2", formatted_address: "City Gym" }],
          error: null,
        },
      },
      calls,
    );
    const out = await listFeedEvents(client, ["tryout"], { now: new Date("2026-11-07T00:00:00Z") });
    expect(
      out.map((e) => [e.id, e.postId, e.spotsTaken, e.venueHidden, e.location, e.price]),
    ).toEqual([
      ["e1", "p-e1", 4, true, null, 15],
      ["e2", "p-e2", 0, false, "City Gym", 15],
    ]);
    expect(calls).toContain('in(["kind",["tryout"]])');
    expect(calls).toContain('or(["starts_at.gte.2026-11-07T00:00:00.000Z,starts_at.is.null"])');
    expect(calls).toContain('order(["starts_at",{"ascending":true,"nullsFirst":false}])');
  });

  it("hides every venue when the venue lookup fails (fail closed)", async () => {
    const client = fake(
      { data: [row("e1")], error: null },
      { get_event_locations: { data: null, error: { message: "x" } } },
    );
    const [ev] = await listFeedEvents(client, ["tryout"]);
    expect(ev.venueHidden).toBe(true);
  });

  it("keeps only events of teams playing the chosen sports", async () => {
    const client = fake({
      data: [row("e1"), row("e2", { teams: { name: "B", sports: ["basketball"] } })],
      error: null,
    });
    expect(
      (await listFeedEvents(client, ["tryout"], { sports: ["basketball"] })).map((e) => e.id),
    ).toEqual(["e2"]);
  });

  it("asks nothing for Pickup, and throws on a read error", async () => {
    const calls: string[] = [];
    expect(await listFeedEvents(fake({ data: [], error: null }, {}, calls), [])).toEqual([]);
    expect(calls).toEqual([]);
    await expect(
      listFeedEvents(fake({ data: null, error: { message: "denied" } }), ["clinic"]),
    ).rejects.toThrow("denied");
  });
});

describe("Home feed page", () => {
  it("shows the type chips and events only while events_v2 is on, and keeps games for All and Pickup", () => {
    const src = readFileSync("src/routes/_tabs.feed.tsx", "utf8");
    expect(src).toMatch(/isEventsV2Enabled\(/);
    expect(src).toMatch(/const feedType: FeedType = eventsOn \? feedTypeState : "all";/);
    expect(src).toMatch(/eventsOn && <FeedTypeChips/);
    expect(src).toMatch(/const showGames = feedType === "all" \|\| feedType === "pickup";/);
  });
});
