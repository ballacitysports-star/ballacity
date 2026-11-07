import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMPTY_VENUE_EVENT_DRAFT,
  TRAINER_EVENT_KINDS,
  buildVenueEventPayload,
  fetchEventWaiver,
  listVenueEvents,
  venueEventErrorMessage,
  type VenueEventsClient,
} from "./venue-events";

const NOW = new Date("2026-11-07T12:00:00Z");
const draft = (over: Partial<typeof EMPTY_VENUE_EVENT_DRAFT> = {}) => ({
  ...EMPTY_VENUE_EVENT_DRAFT,
  kind: "open_gym" as const,
  title: " Friday open gym ",
  startsAt: "2026-12-01T18:00:00Z",
  minAge: "18",
  maxAge: "99",
  ...over,
});

describe("buildVenueEventPayload", () => {
  it("builds the payload create_facility_event takes", () => {
    const r = buildVenueEventPayload(
      draft({ price: "12.5", capacity: "20", address: " 1 Court St ", body: " Bring water " }),
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      payload: {
        kind: "open_gym",
        title: "Friday open gym",
        body: "Bring water",
        starts_at: "2026-12-01T18:00:00.000Z",
        min_age: 18,
        max_age: 99,
        price_cents: 1250,
        capacity: 20,
        location: { formatted_address: "1 Court St" },
      },
    });
  });

  it("leaves optional fields out", () => {
    const r = buildVenueEventPayload(draft(), NOW);
    expect(r.ok && Object.keys(r.payload).sort()).toEqual(
      ["kind", "max_age", "min_age", "starts_at", "title"].sort(),
    );
  });

  it("requires the age range (D1), a title and a future start", () => {
    expect(buildVenueEventPayload(draft({ minAge: "" }), NOW)).toEqual({
      ok: false,
      error: "Add the age range.",
    });
    expect(buildVenueEventPayload(draft({ minAge: "15", maxAge: "12" }), NOW).ok).toBe(false);
    expect(buildVenueEventPayload(draft({ minAge: "3" }), NOW).ok).toBe(false);
    expect(buildVenueEventPayload(draft({ title: "  " }), NOW).ok).toBe(false);
    expect(buildVenueEventPayload(draft({ startsAt: "" }), NOW).ok).toBe(false);
    expect(buildVenueEventPayload(draft({ startsAt: "2026-11-01T18:00:00Z" }), NOW).ok).toBe(false);
    expect(buildVenueEventPayload(draft({ endsAt: "2026-11-30T18:00:00Z" }), NOW).ok).toBe(false);
  });

  it("lets a trainer list clinics and camps only (D7)", () => {
    expect(buildVenueEventPayload(draft({ kind: "camp" }), NOW, TRAINER_EVENT_KINDS).ok).toBe(true);
    expect(buildVenueEventPayload(draft({ kind: "open_gym" }), NOW, TRAINER_EVENT_KINDS).ok).toBe(
      false,
    );
    expect(buildVenueEventPayload(draft({ kind: "tournament" }), NOW, TRAINER_EVENT_KINDS).ok).toBe(
      false,
    );
  });

  it("refuses a tryout (a team thing)", () => {
    expect(buildVenueEventPayload(draft({ kind: "tryout" as never }), NOW).ok).toBe(false);
  });

  it("checks price and spots", () => {
    expect(buildVenueEventPayload(draft({ price: "-1" }), NOW).ok).toBe(false);
    expect(buildVenueEventPayload(draft({ capacity: "0" }), NOW).ok).toBe(false);
    expect(buildVenueEventPayload(draft({ capacity: "2.5" }), NOW).ok).toBe(false);
  });
});

describe("venueEventErrorMessage", () => {
  it("puts the database's refusals in plain words", () => {
    expect(venueEventErrorMessage("NOT_FACILITY_STAFF")).toMatch(/owner and admins/);
    expect(venueEventErrorMessage("ADULT_HOST_REQUIRED")).toMatch(/adults/);
    expect(venueEventErrorMessage("OUTSIDE_AGE_RANGE")).toMatch(/age group/);
    expect(venueEventErrorMessage("EVENT_FULL")).toBe("This event is full.");
    expect(venueEventErrorMessage("something else")).toBe("something else");
  });
});

type Result = { data: unknown; error: { message: string } | null };

function fake(tables: Record<string, Result>, rpcs: Record<string, Result>, calls: string[]) {
  const client: VenueEventsClient = {
    from: (t: string) => {
      calls.push(`from(${t})`);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "or", "order", "limit"])
        q[m] = (...a: unknown[]) => {
          calls.push(`${t}.${m}(${JSON.stringify(a)})`);
          return q;
        };
      q.then = (ok: (r: Result) => unknown) =>
        Promise.resolve(tables[t] ?? { data: [], error: null }).then(ok);
      return q as unknown as ReturnType<VenueEventsClient["from"]>;
    },
    rpc: (fn: string) => Promise.resolve(rpcs[fn] ?? { data: [], error: null }),
  };
  return client;
}

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: "camp",
  title: `Camp ${id}`,
  body: null,
  starts_at: "2026-12-01T17:00:00Z",
  ends_at: null,
  min_age: 8,
  max_age: 14,
  price_cents: 0,
  capacity: 10,
  moderation_status: "approved",
  ...over,
});

describe("listVenueEvents", () => {
  it("reads the venue's facility events with true seats, allowed venues and the viewer's sign-ups", async () => {
    const calls: string[] = [];
    const client = fake(
      {
        events: { data: [ev("a"), ev("b", { moderation_status: "pending" })], error: null },
        event_registrations: {
          data: [
            { event_id: "a", status: "registered" },
            { event_id: "b", status: "cancelled" },
          ],
          error: null,
        },
      },
      {
        get_event_registration_counts: { data: [{ event_id: "a", registered: 3 }], error: null },
        get_event_locations: {
          data: [{ event_id: "b", formatted_address: "1 Court St" }],
          error: null,
        },
      },
      calls,
    );
    const out = await listVenueEvents(client, "org-1", { userId: "u1", now: NOW });
    expect(
      out.map((e) => [e.id, e.spotsTaken, e.venueHidden, e.location, e.registered, e.status]),
    ).toEqual([
      ["a", 3, true, null, true, "approved"],
      ["b", 0, false, "1 Court St", false, "pending"],
    ]);
    expect(calls).toContain('events.eq(["host_kind","facility"])');
    expect(calls).toContain('events.eq(["host_ref","org-1"])');
    expect(calls).toContain('event_registrations.eq(["user_id","u1"])');
  });

  it("does not look up sign-ups when signed out, and throws on a read error", async () => {
    const calls: string[] = [];
    await listVenueEvents(fake({ events: { data: [ev("a")], error: null } }, {}, calls), "org-1");
    expect(calls).not.toContain("from(event_registrations)");
    await expect(
      listVenueEvents(fake({ events: { data: null, error: { message: "denied" } } }, {}, []), "o"),
    ).rejects.toThrow("denied");
  });
});

describe("createVenueEvent", () => {
  it("screens the text first, creates through create_facility_event as the member, then settles moderation", () => {
    const src = readFileSync("src/lib/venue-events.functions.ts", "utf8");
    const screen = src.indexOf("screenPostText(");
    const block = src.indexOf('if (screen === "block")');
    const create = src.search(/rpc\(\s*"create_facility_event"/);
    const settle = src.indexOf('settlePostModeration(supabaseAdmin, "events"');
    expect(screen).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(screen);
    expect(create).toBeGreaterThan(block);
    expect(settle).toBeGreaterThan(create);
    // The member's own client creates it, so the database's staff and age checks apply.
    expect(src).toMatch(/context\.supabase\.rpc\(\s*"create_facility_event"/);
  });
});

describe("fetchEventWaiver", () => {
  const rpcClient = (r: Result, calls: unknown[] = []): VenueEventsClient => ({
    from: () => {
      throw new Error("not used");
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      return Promise.resolve(r);
    },
  });

  it("returns the waiver an event needs, with whether it is signed", async () => {
    const calls: unknown[] = [];
    const w = await fetchEventWaiver(
      rpcClient(
        {
          data: [
            {
              id: "w1",
              team_id: "coachsam",
              title: "Coach Sam waiver",
              content: "Terms",
              signed: false,
            },
          ],
          error: null,
        },
        calls,
      ),
      "e1",
      "kid-1",
    );
    expect(w).toEqual({ id: "w1", title: "Coach Sam waiver", content: "Terms", signed: false });
    expect(calls).toEqual([["get_event_waiver", { _event: "e1", _signer: "kid-1" }]]);
  });

  it("returns null when there is none, and throws on an error", async () => {
    expect(await fetchEventWaiver(rpcClient({ data: [], error: null }), "e1")).toBeNull();
    await expect(
      fetchEventWaiver(rpcClient({ data: null, error: { message: "AUTH_REQUIRED" } }), "e1"),
    ).rejects.toThrow("Sign in first.");
  });
});

describe("createTrainerEvent", () => {
  it("screens first, creates through create_trainer_event as the member, then settles moderation", () => {
    const src = readFileSync("src/lib/venue-events.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("export const createTrainerEvent"));
    const screen = fn.indexOf("screenPostText(");
    const block = fn.indexOf('if (screen === "block")');
    const create = fn.search(/context\.supabase\.rpc\(\s*"create_trainer_event"/);
    const settle = fn.indexOf('settlePostModeration(supabaseAdmin, "events"');
    expect(screen).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(screen);
    expect(create).toBeGreaterThan(block);
    expect(settle).toBeGreaterThan(create);
    expect(fn).toMatch(/TRAINER_EVENT_CONTEXT/);
  });
});
