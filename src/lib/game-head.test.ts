import { describe, expect, it } from "vitest";
import { gamePageHead } from "@/lib/game-head";
import { toPublicGameSeo, type CityGameRow } from "@/lib/city-seo";

const NOW = new Date("2026-10-08T12:00:00Z");

// Values that must never appear for a restricted game, each unlikely to occur by accident.
const SECRET = {
  title: "Zeppelin Heights Run",
  sport: "Lacrosse",
  date: "2026-10-12T19:45:00Z",
  location: "Quillon Secret Gym 42",
  neighborhood: "Vantablack District",
  price: 37.5,
  description: "Bring the blue bibs to the Quillon side door",
};
const LEAKS = [
  "Zeppelin",
  "Lacrosse",
  "lacrosse",
  "2026-10-12",
  "Quillon",
  "Vantablack",
  "37.5",
  "$37",
  "blue bibs",
  "Oct 12",
  "7:45",
];

const row = (
  over: Partial<CityGameRow> = {},
): CityGameRow & {
  description: string;
  all_day: boolean | null;
} => ({
  id: "game-secret-1",
  ...SECRET,
  skill: "All",
  lat: 40.8123,
  lng: -73.9456,
  min_age: 21,
  max_age: 40,
  is_private: false,
  hidden_at: null,
  org_hidden_at: null,
  cancelled_at: null,
  all_day: false,
  ...over,
});

const RESTRICTED: [string, Partial<CityGameRow>][] = [
  ["youth (maximum 17)", { min_age: null, max_age: 17 }],
  ["youth (8 to 12)", { min_age: 8, max_age: 12 }],
  ["mixed-age (16 to 30)", { min_age: 16, max_age: 30 }],
  ["minimum 13, open-ended", { min_age: 13, max_age: null }],
  ["unknown age (no limit)", { min_age: null, max_age: null }],
  ["no minimum, maximum only", { min_age: null, max_age: 40 }],
  ["inverted range", { min_age: 40, max_age: 30 }],
  ["private", { is_private: true }],
  ["hidden", { hidden_at: "2026-10-01T00:00:00Z" }],
  ["cancelled", { cancelled_at: "2026-10-01T00:00:00Z" }],
  ["organization-hidden", { org_hidden_at: "2026-10-01T00:00:00Z" }],
  ["past", { date: "2026-10-01T18:00:00Z" }],
];

/** Everything a signed-out request is sent for this game: the head and the loader payload. */
const signedOutResponse = (over: Partial<CityGameRow>) => {
  const seo = toPublicGameSeo(row(over), NOW);
  return { seo, head: gamePageHead("game-secret-1", seo), loaderData: { gameId: "x", seo } };
};

describe("signed-out metadata for a game that is not public", () => {
  it.each(RESTRICTED)(
    "%s: nothing about the game is in the head or the loader payload",
    (_n, over) => {
      const { seo, head, loaderData } = signedOutResponse(over);
      expect(seo).toBeNull();
      const everything = JSON.stringify({ head, loaderData });
      for (const leak of LEAKS) expect(everything).not.toContain(leak);
      // Coordinates and ages are not in a url, tag or payload either.
      for (const leak of ["40.8123", "-73.9456", "min_age", "max_age", "lat", "lng", "host"]) {
        expect(everything).not.toContain(leak);
      }
    },
  );

  it.each(RESTRICTED)("%s: robots noindex, no canonical, no structured data", (_n, over) => {
    const { head } = signedOutResponse(over);
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(head.links).toBeUndefined();
    expect(head.scripts).toBeUndefined();
  });

  it("the share card url is the same fixed, generic url for every restricted game", () => {
    const urls = RESTRICTED.map(([, over]) => {
      const { head } = signedOutResponse(over);
      return head.meta.find((m) => m.property === "og:image")?.content;
    });
    expect(new Set(urls).size).toBe(1);
    const u = new URL(urls[0]!);
    expect([...u.searchParams.keys()].sort()).toEqual(["kind", "size", "subtitle", "title"]);
    expect(u.searchParams.get("title")).toBe("Pickup game");
    expect(u.searchParams.get("meta")).toBeNull();
  });

  it("the whole head is identical for different restricted games, so nothing varies by reason", () => {
    const heads = RESTRICTED.map(([, over]) => JSON.stringify(signedOutResponse(over).head));
    expect(new Set(heads).size).toBe(1);
  });

  it("is identical to the head for a game that does not exist", () => {
    const missing = JSON.stringify(gamePageHead("game-secret-1", null));
    expect(JSON.stringify(signedOutResponse({ is_private: true }).head)).toBe(missing);
    expect(JSON.stringify(signedOutResponse({ min_age: 16, max_age: 30 }).head)).toBe(missing);
  });
});

describe("signed-out metadata for an eligible adult-only game", () => {
  it.each([
    ["bounded 21 to 40", { min_age: 21, max_age: 40 }],
    ["open-ended 18+", { min_age: 18, max_age: null }],
    ["open-ended 21+", { min_age: 21, max_age: null }],
  ])("%s keeps the intended public details", (_n, over) => {
    const { seo, head } = signedOutResponse(over);
    expect(seo).toMatchObject({ title: SECRET.title, sport: SECRET.sport, indexable: true });
    expect(head.meta).not.toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(head.meta).toContainEqual({ title: `${SECRET.title} — BallaCity` });
    expect(head.links).toEqual([
      { rel: "canonical", href: "https://ballacity.com/games/game-secret-1" },
    ]);
    const ld = JSON.parse(head.scripts![0]!.children);
    expect(ld).toMatchObject({ "@type": "SportsEvent", name: SECRET.title, sport: SECRET.sport });
    const image = head.meta.find((m) => m.property === "og:image")!.content;
    expect(decodeURIComponent(image)).toContain("Lacrosse");
  });
});
