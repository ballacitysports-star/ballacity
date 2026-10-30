import { describe, expect, it } from "vitest";
import {
  MIN_LISTINGS_TO_INDEX,
  bucketByCity,
  citySitemapEntries,
  entitySitemapEntries,
  filterBySport,
  gameAgeRangeIsAdultOnly,
  gameTouchesMinors,
  isPublicGame,
  isPublicOrg,
  isPublicUpcomingGame,
  toPublicGameSeo,
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
  min_age: 21,
  max_age: 40,
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

  // The same table as supabase/tests/290_hosted_games_anon_minors.test.sql: the database is
  // the enforcement layer and this helper must agree with it on every case.
  it.each([
    [21, 40, true],
    [18, 18, true],
    [18, 99, true],
    [18, null, true],
    [21, null, true],
    [null, null, false],
    [null, 40, false],
    [null, 18, false],
    [17, null, false],
    [17, 40, false],
    [16, 30, false],
    [14, null, false],
    [8, 12, false],
    [40, 30, false],
    [30, 12, false],
    [0, null, false],
  ] as const)("age range %s-%s adult-only: %s", (min_age, max_age, adult) => {
    expect(gameAgeRangeIsAdultOnly({ min_age, max_age })).toBe(adult);
    expect(gameTouchesMinors({ min_age, max_age })).toBe(!adult);
    expect(isPublicUpcomingGame(game({ min_age, max_age }), NOW)).toBe(adult);
  });

  it("does not list a game with no age limit, a maximum alone or a mixed range", () => {
    for (const ages of [
      { min_age: null, max_age: null },
      { min_age: null, max_age: 40 },
      { min_age: 16, max_age: 30 },
      { min_age: 13, max_age: null },
    ]) {
      expect(isPublicUpcomingGame(game(ages), NOW)).toBe(false);
    }
  });

  it("keeps open-ended 18+ and 21+ games in city buckets, counts and the sitemap", () => {
    const rows = {
      games: [
        game({ id: "open18", min_age: 18, max_age: null }),
        game({ id: "open21", min_age: 21, max_age: null }),
        game({ id: "bounded", min_age: 21, max_age: 40 }),
        game({ id: "anyage", min_age: null, max_age: null }),
        game({ id: "mixed", min_age: 16, max_age: 30 }),
        game({ id: "teen13", min_age: 13, max_age: null }),
        game({ id: "inverted", min_age: 40, max_age: 30 }),
        game({ id: "private", is_private: true }),
        game({ id: "hidden", hidden_at: "x" }),
        game({ id: "orghidden", org_hidden_at: "x" }),
        game({ id: "cancelled", cancelled_at: "x" }),
      ],
      orgs: [],
      gyms: [],
    };
    const austin = bucketByCity(rows, NOW).get("austin-tx")!;
    expect(austin.games.map((g) => g.id)).toEqual(["open18", "open21", "bounded"]);
    expect(entitySitemapEntries(rows, NOW).map((e) => e.path)).toEqual([
      "/games/open18",
      "/games/open21",
      "/games/bounded",
    ]);
    // Three eligible games reach the indexing threshold; the eight ineligible ones do not count.
    expect(citySitemapEntries(LAUNCH_CITIES, bucketByCity(rows, NOW)).map((e) => e.path)).toEqual([
      "/cities/austin-tx",
      "/cities/austin-tx/basketball",
    ]);
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

describe("toPublicGameSeo", () => {
  const full = (over: Partial<CityGameRow> = {}) => ({
    ...game(over),
    description: "Bring water",
    all_day: false,
  });

  it("returns the public facts for an eligible game and null for everything else", () => {
    expect(toPublicGameSeo(full(), NOW)).toMatchObject({
      id: "g1",
      sport: "Basketball",
      indexable: true,
    });
    for (const over of [
      { is_private: true },
      { hidden_at: "x" },
      { org_hidden_at: "x" },
      { cancelled_at: "x" },
      { date: "2026-10-01T00:00:00Z" },
      { min_age: null, max_age: null },
      { min_age: 16, max_age: 30 },
      { min_age: 40, max_age: 30 },
      { min_age: null, max_age: 17 },
    ]) {
      expect(toPublicGameSeo(full(over), NOW)).toBeNull();
    }
  });
});

describe("isPublicGame", () => {
  it("is the public-discovery rule without the clock", () => {
    const past = { date: "2026-01-01T00:00:00Z" };
    expect(isPublicGame(game(past))).toBe(true);
    expect(isPublicUpcomingGame(game(past), NOW)).toBe(false);
    for (const over of [
      { is_private: true },
      { hidden_at: "x" },
      { org_hidden_at: "x" },
      { cancelled_at: "x" },
      { min_age: null, max_age: null },
      { min_age: 16, max_age: 30 },
      { min_age: 40, max_age: 30 },
    ]) {
      expect(isPublicGame(game(over))).toBe(false);
    }
  });
});

describe("isPublicOrg", () => {
  const org = {
    id: "t",
    name: "Team",
    city: null,
    sports: ["Basketball"],
    kind: "team",
    tagline: null,
    updated_at: null,
  };

  it("keeps youth and teen teams and hidden teams off public pages", () => {
    expect(isPublicOrg({ ...org, age_groups: ["adult"], hidden_at: null })).toBe(true);
    expect(isPublicOrg({ ...org, age_groups: [], hidden_at: null })).toBe(true);
    expect(isPublicOrg({ ...org, age_groups: ["youth"], hidden_at: null })).toBe(false);
    expect(isPublicOrg({ ...org, age_groups: ["adult", "teen"], hidden_at: null })).toBe(false);
    expect(isPublicOrg({ ...org, age_groups: ["adult"], hidden_at: "2026-10-01T00:00:00Z" })).toBe(
      false,
    );
  });
});
