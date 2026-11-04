import { describe, expect, it } from "vitest";
import { toGameOrganizer } from "./game-organizer";

describe("toGameOrganizer", () => {
  it("returns the details the database released", () => {
    expect(
      toGameOrganizer([
        { kind: "minor", display_name: "Sam", avatar_url: "u", relation: "guardian" },
      ]),
    ).toEqual({
      kind: "minor",
      displayName: "Sam",
      avatarUrl: "u",
      relation: "guardian",
    });
  });
  it("never carries a name for a neutral organizer, whatever the row says", () => {
    expect(
      toGameOrganizer([
        { kind: "neutral", display_name: "Leak", avatar_url: "x", relation: "none" },
      ]),
    ).toEqual({
      kind: "neutral",
      displayName: null,
      avatarUrl: null,
      relation: "none",
    });
  });
  it("treats an unknown kind or relation as neutral and no row as unknown", () => {
    expect(
      toGameOrganizer([{ kind: "weird", display_name: "N", avatar_url: null, relation: "boss" }]),
    ).toMatchObject({ kind: "neutral", displayName: null, relation: "none" });
    expect(toGameOrganizer([])).toBeNull();
    expect(toGameOrganizer(null)).toBeNull();
  });
});
