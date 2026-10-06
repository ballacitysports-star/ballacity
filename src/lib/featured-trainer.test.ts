import { describe, expect, it } from "vitest";
import {
  pickFeaturedTrainer,
  summarizeRatings,
  trainerBlurb,
  trainerSpecialties,
  type TrainerCandidate,
} from "@/lib/featured-trainer";

const facility = { id: "o1", name: "Peak Courts", city: "Austin" };
const cand = (over: Partial<TrainerCandidate> = {}): TrainerCandidate => ({
  id: "t1",
  kind: "coach",
  ownerId: "u1",
  name: "Coach A",
  avatar: null,
  city: "Austin",
  sports: ["Basketball"],
  verified: false,
  ratePerHour: 80,
  sessionTypes: ["1-on-1"],
  tagline: null,
  bio: null,
  availabilitySlots: [],
  availabilityRules: [{ day: 1 }],
  facility,
  ...over,
});

describe("pickFeaturedTrainer", () => {
  it("returns null when nobody qualifies", () => {
    expect(pickFeaturedTrainer([])).toBeNull();
    for (const bad of [
      cand({ kind: "team" }),
      cand({ ownerId: null }), // unclaimed: can't receive a booking
      cand({ facility: null }),
      cand({ ratePerHour: null }),
      cand({ ratePerHour: 0 }),
      cand({ availabilityRules: [], availabilitySlots: [] }), // nothing to book
    ]) {
      expect(pickFeaturedTrainer([bad])).toBeNull();
    }
  });

  it("accepts availability slots as well as recurring rules", () => {
    const c = cand({ availabilityRules: [], availabilitySlots: [{ d: "2026-10-10" }] });
    expect(pickFeaturedTrainer([c])?.id).toBe("t1");
  });

  it("prefers basketball / multi-sport, verified and well-reviewed trainers", () => {
    const run = cand({ id: "run", sports: ["Running"], verified: true });
    const hoops = cand({ id: "hoops", sports: ["Basketball"] });
    const multi = cand({ id: "multi", sports: ["Basketball", "Soccer"], verified: true });
    expect(pickFeaturedTrainer([run, hoops, multi])?.id).toBe("multi");
    expect(pickFeaturedTrainer([run, hoops])?.id).toBe("hoops");

    const ratings = summarizeRatings([
      ...Array.from({ length: 8 }, () => ({ reviewee_id: "a", rating: 5 })),
      { reviewee_id: "b", rating: 3 },
    ]);
    const a = cand({ id: "a" });
    const b = cand({ id: "b" });
    expect(pickFeaturedTrainer([b, a], ratings)?.id).toBe("a");
  });

  it("uses real ratings only: none when unreviewed, rounded average otherwise", () => {
    expect(pickFeaturedTrainer([cand()])).toMatchObject({ rating: null, reviewCount: 0 });
    const ratings = summarizeRatings([
      { reviewee_id: "t1", rating: 5 },
      { reviewee_id: "t1", rating: 4 },
      { reviewee_id: "t1", rating: 5 },
    ]);
    expect(pickFeaturedTrainer([cand()], ratings)).toMatchObject({ rating: 4.7, reviewCount: 3 });
  });

  it("is deterministic when scores tie", () => {
    expect(pickFeaturedTrainer([cand({ id: "b" }), cand({ id: "a" })])?.id).toBe("a");
  });
});

describe("summarizeRatings", () => {
  it("ignores out-of-range ratings", () => {
    const m = summarizeRatings([
      { reviewee_id: "x", rating: 0 },
      { reviewee_id: "x", rating: 6 },
      { reviewee_id: "x", rating: Number.NaN },
      { reviewee_id: "x", rating: 4 },
    ]);
    expect(m.get("x")).toEqual({ avg: 4, count: 1 });
  });
});

describe("card text helpers", () => {
  it("builds up to four unique specialty tags", () => {
    expect(
      trainerSpecialties({
        sessionTypes: ["1-on-1", "Clinics", "1-on-1"],
        sports: ["Basketball", "clinics", "Soccer", "Tennis"],
      }),
    ).toEqual(["1-on-1", "Clinics", "Basketball", "Soccer"]);
  });

  it("uses the tagline, else the first bio sentence, capped at 140 chars", () => {
    expect(trainerBlurb({ tagline: "Guard skills.", bio: "Ignored." })).toBe("Guard skills.");
    expect(trainerBlurb({ tagline: null, bio: "Ten years coaching. Then more." })).toBe(
      "Ten years coaching.",
    );
    expect(trainerBlurb({ tagline: null, bio: null })).toBeNull();
    expect(trainerBlurb({ tagline: "x".repeat(200), bio: null })!.length).toBe(138);
  });
});
