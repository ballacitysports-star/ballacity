import { describe, expect, it } from "vitest";
import {
  MIN_LISTINGS_TO_INDEX,
  bucketByCity,
  citySitemapEntries,
  entitySitemapEntries,
  filterBySport,
  isAdultsOnlyGame,
  isAdultsOnlyOrg,
  isPublicUpcomingGame,
  type CityGameRow,
  type CityOrgRow,
} from "@/lib/city-seo";
import { LAUNCH_CITIES, cityBySlug, cityForPoint, cityForText } from "@/lib/launch-cities";

const NOW = new Date("2026-10-08T12:00:00Z");
const AUSTIN = { lat: 30.27, lng: -97.74 };

const game = (over: Partial<CityGameRow> = {}): CityGameRow => ({
  id: "g1",
  title: "Run",
  sport: "Basketball",
  date: "2026-10-10T18:00:00Z",
  location: "Court",
  neighborhood: "Downtown",
  price: 0,
  skill: "All",
  lat: AUSTIN.lat,
  lng: AUSTIN.lng,
  min_age: null,
  max_age: null,
  is_private: false,
  hidden_at: null,
  org_hidden_at: null,
  cancelled_at: null,
  ...over,
});

const org = (over: Partial<CityOrgRow> = {}): CityOrgRow => ({
  id: "o1",
  name: "Team",
  city: "Austin, TX",
  sports: ["Basketball"],
  kind: "team",
  tagline: null,
  age_groups: null,
  hidden_at: null,
  ...over,
});

describe("launch cities", () => {
  it("has unique slugs and resolves them", () => {
    const slugs = LAUNCH_CITIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(cityBySlug("austin-tx")?.name).toBe("Austin");
    expect(cityBySlug("st-louis-mo")?.name).toBe("St. Louis");
  });

  it("places points and text in the right city", () => {
    expect(cityForPoint(AUSTIN.lat, AUSTIN.lng)?.slug).toBe("austin-tx");
    expect(cityForPoint(0, 0)).toBeUndefined();
    expect(cityForText("Austin, TX")?.slug).toBe("austin-tx");
    expect(cityForText("austin")?.slug).toBe("austin-tx");
    expect(cityForText("Austin, MN")).toBeUndefined();
  });
});

describe("public rules", () => {
  it("hides private, hidden, cancelled, past and youth games", () => {
    expect(isPublicUpcomingGame(game(), NOW)).toBe(true);
    expect(isPublicUpcomingGame(game({ is_private: true }), NOW)).toBe(false);
    expect(isPublicUpcomingGame(game({ hidden_at: "x" }), NOW)).toBe(false);
    expect(isPublicUpcomingGame(game({ org_hidden_at: "x" }), NOW)).toBe(false);
    expect(isPublicUpcomingGame(game({ cancelled_at: "x" }), NOW)).toBe(false);
    expect(isPublicUpcomingGame(game({ date: "2026-10-01T00:00:00Z" }), NOW)).toBe(false);
    expect(isPublicUpcomingGame(game({ max_age: 14 }), NOW)).toBe(false);
    expect(isPublicUpcomingGame(game({ min_age: 18, max_age: null }), NOW)).toBe(true);
  });

  it("keeps youth/teen trainers and teams out of buckets and sitemaps", () => {
    const rows = {
      games: [],
      orgs: [org({ id: "t1", kind: "coach", age_groups: ["adult", "teen"] }), org({ id: "t2" })],
      gyms: [],
    };
    const austin = bucketByCity(rows, NOW).get("austin-tx")!;
    expect(austin.teams.map((t) => t.id)).toEqual(["t2"]);
    expect(austin.trainers).toEqual([]);
    expect(entitySitemapEntries(rows, NOW).map((e) => e.path)).toEqual(["/teams/t2"]);
  });
});

describe("sitemap entries", () => {
  it("emits entity paths by kind and only for public upcoming games", () => {
    const entries = entitySitemapEntries(
      {
        games: [game({ id: "a" }), game({ id: "b", is_private: true })],
        orgs: [org({ id: "t" }), org({ id: "c", kind: "coach", age_groups: ["adult"] })],
      },
      NOW,
    );
    expect(entries.map((e) => e.path)).toEqual(["/games/a", "/teams/t", "/trainers/c"]);
  });

  it("omits thin city and city×sport pages", () => {
    const thin = bucketByCity({ games: [game()], orgs: [], gyms: [] }, NOW);
    expect(citySitemapEntries(LAUNCH_CITIES, thin)).toEqual([]);

    const games = Array.from({ length: MIN_LISTINGS_TO_INDEX }, (_, i) => game({ id: `g${i}` }));
    const rich = bucketByCity({ games, orgs: [], gyms: [] }, NOW);
    expect(citySitemapEntries(LAUNCH_CITIES, rich).map((e) => e.path)).toEqual([
      "/cities/austin-tx",
      "/cities/austin-tx/basketball",
    ]);
  });

  it("filters listings by sport case-insensitively", () => {
    const l = bucketByCity(
      { games: [game(), game({ id: "s", sport: "Soccer" })], orgs: [org()], gyms: [] },
      NOW,
    ).get("austin-tx")!;
    const f = filterBySport(l, "basketball");
    expect(f.games).toHaveLength(1);
    expect(f.teams).toHaveLength(1);
  });
});

describe("isAdultsOnlyGame", () => {
  it("requires an explicit 18+ minimum", () => {
    expect(isAdultsOnlyGame({ min_age: 18 })).toBe(true);
    expect(isAdultsOnlyGame({ min_age: 21 })).toBe(true);
    expect(isAdultsOnlyGame({ min_age: 16 })).toBe(false);
    expect(isAdultsOnlyGame({ min_age: null })).toBe(false);
  });
});

describe("isAdultsOnlyOrg", () => {
  it("needs listed age groups with no youth or teen", () => {
    expect(isAdultsOnlyOrg({ age_groups: ["adult"] })).toBe(true);
    expect(isAdultsOnlyOrg({ age_groups: ["adult", "youth"] })).toBe(false);
    expect(isAdultsOnlyOrg({ age_groups: ["teen"] })).toBe(false);
    expect(isAdultsOnlyOrg({ age_groups: [] })).toBe(false);
    expect(isAdultsOnlyOrg({ age_groups: null })).toBe(false);
  });
});
