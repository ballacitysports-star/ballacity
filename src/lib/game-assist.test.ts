import { describe, expect, it } from "vitest";
import { gameDraftSchema } from "@/lib/game-assist.functions";

/**
 * The draft schema is the boundary between model output and a host's form.
 * It rejects rather than coerces: a draft quietly trimmed into shape is harder
 * to notice than one that failed outright, and these fields go on to describe a
 * real-world meet-up.
 */

const valid = {
  title: "Tuesday night hoops",
  description: "Casual 5v5 at the outdoor courts. Bring a light and a dark shirt.",
  equipment: ["Basketball", "Water"],
  maxPlayers: 10,
  skillNote: "Suits anyone comfortable playing full court.",
  checklist: ["Confirm the court is free", "Bring a pump"],
};

describe("game draft schema", () => {
  it("accepts a well-formed draft", () => {
    expect(gameDraftSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a player count that could not be a real pickup game", () => {
    for (const maxPlayers of [0, 1, -5, 61, 5000]) {
      expect(gameDraftSchema.safeParse({ ...valid, maxPlayers }).success).toBe(false);
    }
  });

  it("rejects a non-integer player count", () => {
    expect(gameDraftSchema.safeParse({ ...valid, maxPlayers: 8.5 }).success).toBe(false);
  });

  it("rejects an empty title or description", () => {
    expect(gameDraftSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
    expect(gameDraftSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
    expect(gameDraftSchema.safeParse({ ...valid, description: "" }).success).toBe(false);
  });

  it("rejects a runaway description instead of truncating it", () => {
    const long = gameDraftSchema.safeParse({ ...valid, description: "x".repeat(601) });
    expect(long.success).toBe(false);
  });

  it("rejects an equipment list long enough to be a hallucination", () => {
    expect(
      gameDraftSchema.safeParse({ ...valid, equipment: Array(9).fill("Cones") }).success,
    ).toBe(false);
  });

  it("rejects wrong types outright", () => {
    expect(gameDraftSchema.safeParse({ ...valid, equipment: "Basketball" }).success).toBe(false);
    expect(gameDraftSchema.safeParse({ ...valid, maxPlayers: "10" }).success).toBe(false);
    expect(gameDraftSchema.safeParse({ ...valid, checklist: null }).success).toBe(false);
  });

  it("rejects a draft missing a field the form expects", () => {
    for (const key of Object.keys(valid)) {
      const partial = { ...valid } as Record<string, unknown>;
      delete partial[key];
      expect(gameDraftSchema.safeParse(partial).success).toBe(false);
    }
  });

  it("allows empty lists and an empty skill note", () => {
    // A thin draft is a legitimate answer when the host gave little to work on;
    // the prompt asks for restraint rather than invented filler.
    const thin = { ...valid, equipment: [], checklist: [], skillNote: "" };
    expect(gameDraftSchema.safeParse(thin).success).toBe(true);
  });
});
