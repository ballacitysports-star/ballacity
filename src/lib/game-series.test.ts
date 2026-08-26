import { describe, expect, it } from "vitest";
import { collapseSeriesGames } from "./game-series";
import type { Game } from "./sample-data";

const base: Game = {
  id: "g",
  sport: "Soccer",
  title: "Pickup",
  host: { name: "H", username: "@h", avatar: "H", rating: 5 },
  date: new Date("2026-09-01T18:00:00Z").toISOString(),
  duration: "90 min",
  location: "Park",
  neighborhood: "",
  distanceMi: 1,
  lat: 50,
  lng: 50,
  maxPlayers: 10,
  joined: 0,
  skill: "All Levels",
  price: 0,
  indoor: false,
  isPrivate: false,
  image: "",
  description: "",
  equipment: [],
};

const NOW = +new Date("2026-08-26T12:00:00Z");

function day(id: string, iso: string, seriesId?: string): Game {
  return { ...base, id, date: iso, seriesId: seriesId ?? null };
}

describe("collapseSeriesGames", () => {
  it("passes through games without a series", () => {
    const games = [day("a", "2026-09-01T18:00:00Z"), day("b", "2026-09-02T18:00:00Z")];
    expect(collapseSeriesGames(games, "upcoming", NOW)).toHaveLength(2);
  });

  it("collapses a multi-day series to one card (earliest upcoming)", () => {
    const games = [
      day("s1", "2026-09-01T18:00:00Z", "ser1"),
      day("x", "2026-09-01T12:00:00Z"),
      day("s2", "2026-09-03T18:00:00Z", "ser1"),
      day("s3", "2026-09-05T18:00:00Z", "ser1"),
    ];
    const out = collapseSeriesGames(games, "upcoming", NOW);
    expect(out).toHaveLength(2);
    const rep = out.find((g) => g.seriesId === "ser1")!;
    expect(rep.id).toBe("s1");
    expect(rep.seriesCount).toBe(3);
  });

  it("advances the representative as sessions finish", () => {
    const games = [
      day("s1", "2026-08-20T18:00:00Z", "ser1"), // finished
      day("s2", "2026-09-03T18:00:00Z", "ser1"), // upcoming
    ];
    const out = collapseSeriesGames(games, "upcoming", NOW);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s2");
  });

  it("drops a fully finished series from upcoming and shows latest in archive", () => {
    const games = [
      day("s1", "2026-08-20T18:00:00Z", "ser1"),
      day("s2", "2026-08-22T18:00:00Z", "ser1"),
    ];
    expect(collapseSeriesGames(games, "upcoming", NOW)).toHaveLength(0);
    const arch = collapseSeriesGames(games, "archive", NOW);
    expect(arch).toHaveLength(1);
    expect(arch[0].id).toBe("s2");
    expect(arch[0].seriesCount).toBe(2);
  });
});
