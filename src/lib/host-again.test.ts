import { describe, expect, it } from "vitest";
import { hostAgainPrefill } from "./host-again";
import type { Game } from "@/lib/sample-data";

const game = (over: Partial<Game> = {}): Game =>
  ({
    id: "g1",
    sport: "Basketball",
    title: "Sunday run",
    host: { name: "H", username: "h", avatar: "", rating: 0 },
    hostUserId: "me",
    date: "2026-10-01T15:00:00Z",
    duration: "90 min",
    location: "Old Court",
    neighborhood: "",
    maxPlayers: 12,
    joined: 12,
    skill: "All Levels",
    price: 0,
    indoor: true,
    isPrivate: false,
    image: "x",
    description: "Bring water",
    equipment: [],
    status: "completed",
    signupCutoffMin: 60,
    minAge: 18,
    maxAge: null,
    ...over,
  }) as Game;

describe("hostAgainPrefill", () => {
  it("carries over what a host sets once, and leaves date, venue and roster behind", () => {
    const p = hostAgainPrefill(game(), "me");
    expect(p).toMatchObject({
      sport: "Basketball",
      title: "Sunday run",
      description: "Bring water",
      skill: "All Levels",
      paid: false,
      indoor: true,
      priv: false,
      minAge: 18,
      maxAge: null,
      signupCutoffMin: 60,
      maxPlayers: 12,
    });
    expect(p).not.toHaveProperty("date");
    expect(p).not.toHaveProperty("location");
    expect(p).not.toHaveProperty("lat");
  });

  it("turns the entry fee back on for a paid game", () => {
    expect(hostAgainPrefill(game({ price: 8 }), "me")).toMatchObject({ paid: true, feeText: "8" });
  });

  it("is only for the game's own host", () => {
    expect(hostAgainPrefill(game(), "someone-else")).toBeNull();
    expect(hostAgainPrefill(game(), null)).toBeNull();
    expect(hostAgainPrefill(game({ hostUserId: undefined }), "me")).toBeNull();
  });

  it("ignores a nonsense size", () => {
    expect(hostAgainPrefill(game({ maxPlayers: 0 }), "me")?.maxPlayers).toBeUndefined();
  });
});
