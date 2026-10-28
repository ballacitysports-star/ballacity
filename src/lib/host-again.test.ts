import { describe, expect, it } from "vitest";
import { hostAgainPrefill, planHostAgain } from "./host-again";
import { loadCreateDraft, saveCreateDraft } from "./create-draft";
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

describe("approval to join", () => {
  it("is always required on the copy, whatever the old game allowed", () => {
    expect(hostAgainPrefill(game(), "me")?.requiresApproval).toBe(true);
  });
});

describe("an unfinished game is not silently lost", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  it("asks first when the form has a title or a description", () => {
    expect(planHostAgain({ title: "Friday 5s" })).toBe("confirm");
    expect(planHostAgain({ description: "Bring a dark shirt" })).toBe("confirm");
  });

  it("copies straight in when the form is empty or only whitespace", () => {
    expect(planHostAgain({})).toBe("apply");
    expect(planHostAgain({ title: "  ", description: "" })).toBe("apply");
  });

  it("leaves the saved draft untouched while the host decides", () => {
    const storage = memory();
    saveCreateDraft(storage, "me", { title: "Friday 5s", description: "Bring a dark shirt" });
    const before = loadCreateDraft(storage, "me");
    expect(before?.title).toBe("Friday 5s");

    // What the page does when a copy is requested: build the copy and plan.
    const copy = hostAgainPrefill(game(), "me");
    expect(copy).not.toBeNull();
    expect(planHostAgain({ title: before?.title, description: before?.description })).toBe(
      "confirm",
    );

    expect(loadCreateDraft(storage, "me")).toEqual(before);
  });
});

describe("venue", () => {
  it("is never copied, even when the old game was geocoded", () => {
    const p = hostAgainPrefill(game({ location: "Old Court", lat: 40.7, lng: -74 }), "me");
    expect(p).not.toHaveProperty("location");
    expect(p).not.toHaveProperty("lat");
    expect(p).not.toHaveProperty("lng");
  });
});
