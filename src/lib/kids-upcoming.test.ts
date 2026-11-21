import { describe, expect, it } from "vitest";
import type { ChildActivity, ChildGame } from "@/lib/guardian-activity.functions";
import { nextKidsGames } from "@/lib/kids-upcoming";

const NOW = Date.parse("2026-11-10T12:00:00Z");

function game(id: string, date: string, status: ChildGame["status"] = "joined"): ChildGame {
  return {
    gameId: id,
    title: `Game ${id}`,
    sport: "Basketball",
    date,
    location: null,
    status,
    cancelCutoffMin: 0,
  };
}

function kid(name: string, upcoming: ChildGame[]): ChildActivity {
  return {
    childUserId: `id-${name}`,
    name,
    avatarUrl: null,
    teams: [],
    upcoming,
    recent: [],
    invites: [],
    waivers: [],
    updates: [],
    tryouts: [],
  };
}

describe("nextKidsGames", () => {
  it("merges all children's games, soonest first, and keeps the first three", () => {
    const kids = [
      kid("Maya", [game("a", "2026-11-14T15:00:00Z"), game("b", "2026-11-11T15:00:00Z")]),
      kid("Leo", [
        game("c", "2026-11-12T15:00:00Z", "requested"),
        game("d", "2026-11-20T15:00:00Z"),
      ]),
    ];
    const next = nextKidsGames(kids, NOW);
    expect(next.map((n) => n.game.gameId)).toEqual(["b", "c", "a"]);
    expect(next.map((n) => n.child)).toEqual(["Maya", "Leo", "Maya"]);
  });

  it("leaves out games that have already started", () => {
    const kids = [
      kid("Maya", [game("past", "2026-11-10T11:00:00Z"), game("soon", "2026-11-10T13:00:00Z")]),
    ];
    expect(nextKidsGames(kids, NOW).map((n) => n.game.gameId)).toEqual(["soon"]);
  });

  it("is empty without children or games", () => {
    expect(nextKidsGames([], NOW)).toEqual([]);
    expect(nextKidsGames([kid("Maya", [])], NOW)).toEqual([]);
  });
});
