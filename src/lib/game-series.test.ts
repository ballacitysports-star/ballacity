import { describe, expect, it } from "vitest";
import { collapseSeriesGames, groupProfileGames } from "./game-series";
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

describe("groupProfileGames", () => {
  const hostGame = (id: string, iso: string, seriesId?: string) => ({
    ...day(id, iso, seriesId),
    hostUserId: "me",
  });

  it("lists a game the host hid under Hosting, and one a player joined under Playing", () => {
    const pool = [
      { ...hostGame("mine", "2026-10-24T18:00:00Z"), hidden: true },
      { ...day("theirs", "2026-10-25T18:00:00Z"), hostUserId: "other", hidden: true },
      { ...day("not-mine", "2026-10-26T18:00:00Z"), hostUserId: "other", hidden: true },
    ];
    const now = +new Date("2026-10-20T12:00:00Z");
    const g = groupProfileGames(pool, new Set(["theirs"]), "me", now);
    expect(g.hosting.map((x) => x.id)).toEqual(["mine"]);
    expect(g.playing.map((x) => x.id)).toEqual(["theirs"]);
    expect(g.total).toBe(2);
  });

  it("collapses a hosted weekend series to the next session in Hosting", () => {
    const pool = [
      hostGame("sat", "2026-10-24T18:00:00Z", "wk"),
      hostGame("sun", "2026-10-25T18:00:00Z", "wk"),
    ];
    const now = +new Date("2026-10-20T12:00:00Z");
    const g = groupProfileGames(pool, new Set(), "me", now);
    expect(g.hosting.map((x) => x.id)).toEqual(["sat"]);
    expect(g.hosting[0].seriesCount).toBe(2);
    expect(g.total).toBe(1);
    expect(g.archiveTotal).toBe(0);
  });

  it("advances to Sunday after Saturday finishes, keeping Saturday in Archive", () => {
    const pool = [
      hostGame("sat", "2026-10-24T18:00:00Z", "wk"),
      hostGame("sun", "2026-10-25T18:00:00Z", "wk"),
    ];
    const now = +new Date("2026-10-25T08:00:00Z");
    const g = groupProfileGames(pool, new Set(), "me", now);
    expect(g.hosting.map((x) => x.id)).toEqual(["sun"]);
    expect(g.archiveHosting.map((x) => x.id)).toEqual(["sat"]);
  });

  it("moves the whole series to Archive once every session is finished", () => {
    const pool = [
      hostGame("sat", "2026-10-24T18:00:00Z", "wk"),
      hostGame("sun", "2026-10-25T18:00:00Z", "wk"),
    ];
    const now = +new Date("2026-10-30T12:00:00Z");
    const g = groupProfileGames(pool, new Set(), "me", now);
    expect(g.total).toBe(0);
    expect(g.archiveHosting.map((x) => x.id)).toEqual(["sun"]);
    expect(g.archiveHosting[0].seriesCount).toBe(2);
  });

  it("collapses joined series into Playing and ignores games the user is not in", () => {
    const pool = [
      day("a", "2026-10-24T18:00:00Z", "s1"),
      day("b", "2026-10-25T18:00:00Z", "s1"),
      day("other", "2026-10-26T18:00:00Z"),
    ];
    const now = +new Date("2026-10-20T12:00:00Z");
    const g = groupProfileGames(pool, new Set(["a", "b"]), "me", now);
    expect(g.playing.map((x) => x.id)).toEqual(["a"]);
    expect(g.hosting).toHaveLength(0);
  });
});
