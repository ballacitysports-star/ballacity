import { describe, expect, it } from "vitest";
import { areaById, osmTasks, overpassQuery, parseOverpass, searchTasks } from "./areas";

const atlanta = areaById("atlanta")!;

describe("discovery plan", () => {
  it("searches every requested type, always scoped to the area", () => {
    const tasks = searchTasks(atlanta, ["gym", "team", "coach"]);
    expect(tasks.length).toBeGreaterThan(20);
    expect(tasks.every((t) => t.q.endsWith("Atlanta GA"))).toBe(true);
    expect(new Set(tasks.map((t) => t.type))).toEqual(new Set(["gym", "team", "coach"]));
    expect(searchTasks(atlanta, ["coach"]).every((t) => t.type === "coach")).toBe(true);
  });

  it("looks on the map for facilities and clubs, never trainers", () => {
    expect(osmTasks(["gym", "team", "coach"]).map((t) => t.type)).toEqual(["gym", "team"]);
  });

  it("builds an Overpass query inside the area that requires a website", () => {
    const q = overpassQuery(atlanta, "gym");
    expect(q).toContain("33.6,-84.65,34,-84.15");
    expect(q).toContain('["leisure"~"^(sports_centre|fitness_centre|sports_hall)$"]');
    expect(q).toContain('["website"]');
    expect(q).toContain('["contact:website"]');
    expect(q).toContain("out tags center");
    expect(overpassQuery(atlanta, "team")).toContain('["club"="sport"]');
  });

  it("keeps only the website and a hint from map data", () => {
    const leads = parseOverpass({
      elements: [
        {
          type: "way",
          id: 1,
          tags: {
            name: "Court A",
            sport: "basketball",
            website: "https://a.com",
            "addr:street": "Secret St",
          },
        },
        { type: "node", id: 2, tags: { name: "No Site" } },
        { type: "node", id: 3, tags: { "contact:website": "b.org" } },
        { type: "relation", id: "x", tags: { website: "https://c.com" } },
      ],
    });
    expect(leads).toEqual([
      { ref: "way/1", website: "https://a.com", hintName: "Court A", hintSport: "basketball" },
      { ref: "node/3", website: "b.org", hintName: null, hintSport: null },
    ]);
    expect(parseOverpass(null)).toEqual([]);
    expect(parseOverpass({ elements: "nope" })).toEqual([]);
  });
});
