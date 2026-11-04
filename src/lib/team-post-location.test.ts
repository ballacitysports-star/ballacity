import { describe, expect, it } from "vitest";
import { exactLocationMap, withExactTeamPostLocation } from "./team-post-location";

describe("withExactTeamPostLocation", () => {
  const exact = exactLocationMap([{ post_id: "p1", location: "Lincoln Elementary Gym" }]);
  it("overlays the exact venue the database released", () => {
    expect(withExactTeamPostLocation({ id: "p1", location: "Atlanta", title: "T" }, exact)).toEqual(
      {
        id: "p1",
        location: "Lincoln Elementary Gym",
        title: "T",
      },
    );
  });
  it("leaves a post alone when nothing was released for it (viewer not entitled, or adult team)", () => {
    const post = { id: "p2", location: "Atlanta" };
    expect(withExactTeamPostLocation(post, exact)).toBe(post);
    expect(withExactTeamPostLocation(post, exactLocationMap(null))).toBe(post);
  });
  it("does not blank the location when the released row has none", () => {
    const post = { id: "p3", location: "Atlanta" };
    expect(
      withExactTeamPostLocation(post, exactLocationMap([{ post_id: "p3", location: null }])),
    ).toBe(post);
  });
});
