import { describe, expect, it } from "vitest";
import type { Game } from "@/lib/sample-data";
import {
  buildHappeningSoon,
  facilityActivityLabel,
  facilityDistanceMi,
  facilityRunCounts,
  happeningSoonBadge,
  parseOrgGeo,
  rankNearbyFacilities,
  soonPriceLabel,
  soonSpotsLabel,
  soonWhenLabel,
  sortTryoutsByDate,
  tryoutAgeDivision,
  tryoutPriceLabel,
  tryoutSpotsLeft,
  tryoutStatusLine,
  tryoutWhenLine,
} from "./curated-dashboard";

const TZ = "America/New_York";
// Tue Oct 6 2026, 14:00 EDT.
const NOW = Date.UTC(2026, 9, 6, 18, 0, 0);
const HOUR = 3_600_000;

function game(over: Partial<Game> & { id: string }): Game {
  return {
    sport: "Basketball",
    title: "Run",
    host: { name: "Host", username: "host", avatar: "H", rating: 5 },
    date: new Date(NOW + 3 * HOUR).toISOString(),
    duration: "90 min",
    location: "Court",
    neighborhood: "Downtown",
    maxPlayers: 10,
    joined: 4,
    skill: "All Levels",
    price: 0,
    indoor: true,
    isPrivate: false,
    image: "",
    description: "",
    equipment: [],
    timezone: TZ,
    ...over,
  } as Game;
}

describe("buildHappeningSoon", () => {
  it("keeps open runs inside 48h, soonest first", () => {
    const later = game({ id: "later", date: new Date(NOW + 30 * HOUR).toISOString() });
    const sooner = game({ id: "sooner", date: new Date(NOW + 2 * HOUR).toISOString() });
    const tooFar = game({ id: "far", date: new Date(NOW + 49 * HOUR).toISOString() });
    const out = buildHappeningSoon([later, tooFar, sooner], { now: NOW });
    expect(out.games.map((g) => g.id)).toEqual(["sooner", "later"]);
    expect(out.total).toBe(2);
  });

  it("drops full, private, cancelled, started and signup-closed runs", () => {
    const at = new Date(NOW + 2 * HOUR).toISOString();
    const out = buildHappeningSoon(
      [
        game({ id: "full", date: at, joined: 10 }),
        game({ id: "private", date: at, isPrivate: true }),
        game({ id: "cancelled", date: at, status: "cancelled" }),
        game({ id: "started", date: new Date(NOW - 10 * 60_000).toISOString() }),
        game({ id: "closed", date: at, joinsClosed: true }),
        game({ id: "cutoff", date: at, signupCutoffMin: 180 }),
        game({ id: "ok", date: at }),
      ],
      { now: NOW },
    );
    expect(out.games.map((g) => g.id)).toEqual(["ok"]);
  });

  it("skips runs the viewer already joined or hosts", () => {
    const at = new Date(NOW + 2 * HOUR).toISOString();
    const out = buildHappeningSoon(
      [game({ id: "mine", date: at }), game({ id: "open", date: at })],
      {
        now: NOW,
        excludeIds: new Set(["mine"]),
      },
    );
    expect(out.games.map((g) => g.id)).toEqual(["open"]);
  });

  it("caps the list but still reports the full count and today's runs", () => {
    const games = Array.from({ length: 5 }, (_, i) =>
      game({ id: `g${i}`, date: new Date(NOW + (i + 1) * HOUR).toISOString() }),
    );
    const out = buildHappeningSoon(games, { now: NOW, limit: 2 });
    expect(out.games).toHaveLength(2);
    expect(out.total).toBe(5);
    // 3pm–7pm EDT are all still Oct 6.
    expect(out.today).toBe(5);
  });

  it("counts a run after midnight as tomorrow's, not today's", () => {
    // Oct 7 01:00 EDT is 11 hours out.
    const pastMidnight = game({ id: "late", date: new Date(NOW + 11 * HOUR).toISOString() });
    const out = buildHappeningSoon([pastMidnight], { now: NOW });
    expect(out.total).toBe(1);
    expect(out.today).toBe(0);
  });

  it("breaks start-time ties by distance from the viewer", () => {
    const at = new Date(NOW + 2 * HOUR).toISOString();
    const near = game({ id: "near", date: at, lat: 33.75, lng: -84.39 });
    const far = game({ id: "far", date: at, lat: 34.5, lng: -84.39 });
    const out = buildHappeningSoon([far, near], { now: NOW, viewer: { lat: 33.76, lng: -84.39 } });
    expect(out.games.map((g) => g.id)).toEqual(["near", "far"]);
  });
});

describe("happeningSoonBadge", () => {
  it("prefers today's count, then the 48h count, then nothing", () => {
    expect(happeningSoonBadge({ today: 3, total: 5 })).toBe("3 runs today");
    expect(happeningSoonBadge({ today: 1, total: 1 })).toBe("1 run today");
    expect(happeningSoonBadge({ today: 0, total: 2 })).toBe("2 in the next 48h");
    expect(happeningSoonBadge({ today: 0, total: 0 })).toBeNull();
  });
});

describe("soon card labels", () => {
  it("labels the day relative to the game's own timezone", () => {
    const today = game({ id: "a", date: new Date(Date.UTC(2026, 9, 6, 22, 30)).toISOString() });
    const tomorrow = game({ id: "b", date: new Date(Date.UTC(2026, 9, 7, 13, 0)).toISOString() });
    expect(soonWhenLabel(today, NOW)).toBe("Today at 6:30 PM");
    expect(soonWhenLabel(tomorrow, NOW)).toBe("Tomorrow at 9:00 AM");
  });

  it("formats price and spots", () => {
    expect(soonPriceLabel(0)).toBe("Free");
    expect(soonPriceLabel(10)).toBe("$10 direct pay");
    expect(soonPriceLabel(7.5)).toBe("$7.50 direct pay");
    expect(soonSpotsLabel(0, 10)).toBe("Full");
    expect(soonSpotsLabel(1, 10)).toBe("1 spot open");
    expect(soonSpotsLabel(2, 10)).toBe("2 spots open");
    expect(soonSpotsLabel(2, 20)).toBe("Almost full");
  });
});

describe("tryoutAgeDivision", () => {
  const div = (title: string, teamAgeGroups: string[] = []) =>
    tryoutAgeDivision({ title, teamAgeGroups });

  it("reads the age cap from common title patterns", () => {
    expect(div("U14 fall tryouts")).toBe("14U");
    expect(div("Fall 14U Select Tryout")).toBe("14U");
    expect(div("Under 12 camp")).toBe("12U");
    expect(div("12 & under skills clinic")).toBe("12U");
  });

  it("recognises high school, adult and explicit open events", () => {
    expect(div("Varsity tryouts")).toBe("High School");
    expect(div("Adult league clinic")).toBe("Adult");
    expect(div("Open tryout")).toBe("Open");
  });

  it("ignores numbers that are not ages", () => {
    expect(div("Summer 2026 camp")).toBe("Open");
    expect(div("U40 masters run")).toBe("Open");
  });

  it("falls back to the team's single age group, else Open", () => {
    expect(div("Fall tryouts", ["youth"])).toBe("Youth");
    expect(div("Fall tryouts", ["teen", "adult"])).toBe("Open");
    expect(div("Fall tryouts")).toBe("Open");
  });
});

describe("tryout labels", () => {
  it("derives spots left, never negative, null without a cap", () => {
    expect(tryoutSpotsLeft({ spotsMax: 30, spotsTaken: 3 })).toBe(27);
    expect(tryoutSpotsLeft({ spotsMax: 30, spotsTaken: 31 })).toBe(0);
    expect(tryoutSpotsLeft({ spotsMax: null, spotsTaken: 4 })).toBeNull();
  });

  it("builds the spots and waiver line", () => {
    expect(tryoutStatusLine({ spotsMax: 30, spotsTaken: 3 }, true)).toBe(
      "27 spots left · Waiver required",
    );
    expect(tryoutStatusLine({ spotsMax: 30, spotsTaken: 29 }, false)).toBe(
      "1 spot left · No waiver",
    );
    expect(tryoutStatusLine({ spotsMax: 30, spotsTaken: 30 }, true)).toBe("Full · Waiver required");
    expect(tryoutStatusLine({ spotsMax: null, spotsTaken: 0 }, false)).toBe(
      "Open registration · No waiver",
    );
    // Unknown waiver status says nothing rather than guessing.
    expect(tryoutStatusLine({ spotsMax: 30, spotsTaken: 3 }, null)).toBe("27 spots left");
  });

  it("formats price", () => {
    expect(tryoutPriceLabel(null)).toBe("Free");
    expect(tryoutPriceLabel(0)).toBe("Free");
    expect(tryoutPriceLabel(25)).toBe("$25");
  });

  it("builds the when line, with and without a venue or date", () => {
    const line = tryoutWhenLine({
      eventDate: "2026-10-17T14:00:00.000Z",
      location: " Bogan Park ",
    });
    expect(line).toMatch(/^\w{3} Oct \d{1,2} · \d{1,2}:\d{2} [AP]M · Bogan Park$/);
    expect(tryoutWhenLine({ eventDate: null, location: null })).toBe("Date TBA");
  });

  it("sorts soonest first with undated events last", () => {
    const rows = [
      { id: "tba", eventDate: null },
      { id: "late", eventDate: "2026-11-01T00:00:00Z" },
      { id: "soon", eventDate: "2026-10-10T00:00:00Z" },
    ];
    expect(sortTryoutsByDate(rows).map((r) => r.id)).toEqual(["soon", "late", "tba"]);
    expect(rows[0].id).toBe("tba");
  });
});

describe("facility helpers", () => {
  const run = (orgId: string | undefined, hoursAhead: number, over: Partial<Game> = {}) =>
    game({
      id: `${orgId}-${hoursAhead}`,
      orgId,
      date: new Date(NOW + hoursAhead * HOUR).toISOString(),
      ...over,
    });

  it("counts public upcoming runs per facility over the next 7 days", () => {
    const counts = facilityRunCounts(
      [
        run("a", 2),
        run("a", 70),
        run("a", 24 * 8), // beyond a week
        run("a", 5, { isPrivate: true }),
        run("a", 6, { status: "cancelled" }),
        run("b", 3),
        run(undefined, 3),
      ],
      NOW,
    );
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("words the activity snippet", () => {
    expect(facilityActivityLabel(4)).toBe("4 pickup runs hosted here this week");
    expect(facilityActivityLabel(1)).toBe("1 pickup run hosted here this week");
    expect(facilityActivityLabel(0)).toMatch(/be the first/);
  });

  it("parses facility geo defensively", () => {
    expect(parseOrgGeo({ lat: 33.7, lng: -84.4 })).toEqual({ lat: 33.7, lng: -84.4 });
    expect(parseOrgGeo(null)).toBeNull();
    expect(parseOrgGeo([])).toBeNull();
    expect(parseOrgGeo({ lat: "33", lng: -84 })).toBeNull();
    expect(parseOrgGeo({ lat: 120, lng: 0 })).toBeNull();
    expect(parseOrgGeo({ lat: 0, lng: 0 })).toBeNull();
  });

  it("measures distance only when both sides have a location", () => {
    const viewer = { lat: 33.75, lng: -84.39 };
    const mi = facilityDistanceMi({ lat: 33.85, lng: -84.39 }, viewer);
    expect(mi).toBeGreaterThan(6);
    expect(mi).toBeLessThan(8);
    expect(facilityDistanceMi({ lat: 33.85, lng: -84.39 }, null)).toBeNull();
    expect(facilityDistanceMi(null, viewer)).toBeNull();
  });

  describe("rankNearbyFacilities", () => {
    const rows = [
      { id: "far", geo: { lat: 34.5, lng: -84.39 } },
      { id: "nogeo", geo: null },
      { id: "near", geo: { lat: 33.76, lng: -84.39 }, featured_at: null },
      { id: "featured", geo: { lat: 34.0, lng: -84.39 }, featured_at: "2026-10-01T00:00:00Z" },
    ];

    it("orders nearest first with ungeocoded gyms last when the viewer is located", () => {
      const out = rankNearbyFacilities(rows, { lat: 33.75, lng: -84.39 }, new Map());
      expect(out.map((r) => r.id)).toEqual(["near", "featured", "far", "nogeo"]);
      expect(out[0].distanceMi).not.toBeNull();
      expect(out[3].distanceMi).toBeNull();
    });

    it("leads with featured then busiest when there is no viewer location", () => {
      const out = rankNearbyFacilities(
        rows,
        null,
        new Map([
          ["far", 3],
          ["near", 1],
        ]),
      );
      expect(out.map((r) => r.id)).toEqual(["featured", "far", "near", "nogeo"]);
    });

    it("respects the limit", () => {
      expect(rankNearbyFacilities(rows, null, new Map(), 2)).toHaveLength(2);
    });
  });
});
