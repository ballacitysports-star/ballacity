import { describe, expect, it } from "vitest";
import { needsPlayers, urgentFirst } from "./feed-order";

const run = (id: string, urgent: boolean, joined: number, maxPlayers = 10) => ({
  id,
  urgent,
  joined,
  maxPlayers,
});

describe("needsPlayers", () => {
  it("is true only for urgent runs with a spot left", () => {
    expect(needsPlayers(run("a", true, 4))).toBe(true);
    expect(needsPlayers(run("b", true, 10))).toBe(false); // full
    expect(needsPlayers(run("c", false, 4))).toBe(false); // not flagged
    expect(needsPlayers({ joined: 1, maxPlayers: 10 })).toBe(false); // flag unset
  });
});

describe("urgentFirst", () => {
  it("floats runs that need players to the top and keeps order within each group", () => {
    const runs = [
      run("soon-normal", false, 3),
      run("later-urgent", true, 5),
      run("soon-full-urgent", true, 10),
      run("latest-urgent", true, 2),
      run("last-normal", false, 1),
    ];
    // Input is already in "soonest first" order; a stable sort must preserve it per group.
    expect([...runs].sort(urgentFirst).map((r) => r.id)).toEqual([
      "later-urgent",
      "latest-urgent",
      "soon-normal",
      "soon-full-urgent",
      "last-normal",
    ]);
  });

  it("leaves a list with nothing urgent untouched", () => {
    const runs = [run("a", false, 1), run("b", false, 2), run("c", true, 10)];
    expect([...runs].sort(urgentFirst).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
