import { describe, expect, it } from "vitest";
import { buildQuickPost, quickDateKey, quickDefaults } from "./quick-availability";

const profile = {
  sports: [{ name: "Basketball", level: { system: "Level", tier: "Rec League" } }],
  city: "Buford, GA",
};
// Tuesday 17 November 2026, 10:00 local time.
const tuesdayMorning = new Date(2026, 10, 17, 10, 0);

describe("quickDefaults", () => {
  it("prefills the profile's sport and city, pickup, this evening", () => {
    expect(quickDefaults(profile, tuesdayMorning)).toEqual({
      sport: "Basketball",
      day: "today",
      timeId: "evening",
      weekly: false,
      intents: ["pickup"],
      city: "Buford, GA",
    });
  });

  it("late at night it suggests tomorrow", () => {
    expect(quickDefaults(profile, new Date(2026, 10, 17, 21, 30)).day).toBe("tomorrow");
  });

  it("with no profile: basketball, no city", () => {
    expect(quickDefaults(null, tuesdayMorning)).toMatchObject({ sport: "Basketball", city: "" });
  });
});

describe("buildQuickPost", () => {
  const base = quickDefaults(profile, tuesdayMorning);

  it("this evening: one dated slot with the profile's level", () => {
    const r = buildQuickPost(base, profile, tuesdayMorning);
    expect(r).toEqual({
      ok: true,
      payload: {
        sports: ["Basketball"],
        skill_level: "Rec League",
        skill_levels: { Basketball: "Rec League" },
        looking_for: ["pickup"],
        time_slots: [{ date: "2026-11-17", start: "17:00", end: "22:00" }],
        city: "Buford, GA",
        travel_radius_km: 40,
      },
    });
  });

  it("tomorrow morning", () => {
    const r = buildQuickPost(
      { ...base, day: "tomorrow", timeId: "morning" },
      profile,
      tuesdayMorning,
    );
    expect(r.ok && r.payload.time_slots).toEqual([
      { date: "2026-11-18", start: "06:00", end: "11:00" },
    ]);
  });

  it("every week: a weekday slot for the chosen day (Tuesday = 2)", () => {
    const r = buildQuickPost({ ...base, weekly: true }, profile, tuesdayMorning);
    expect(r.ok && r.payload.time_slots).toEqual([{ weekday: 2, start: "17:00", end: "22:00" }]);
  });

  it("a picked date", () => {
    expect(quickDateKey({ date: "2026-11-21" }, tuesdayMorning)).toBe("2026-11-21");
    const r = buildQuickPost({ ...base, day: { date: "2026-11-21" } }, profile, tuesdayMorning);
    expect(r.ok && r.payload.time_slots).toEqual([
      { date: "2026-11-21", start: "17:00", end: "22:00" },
    ]);
  });

  it("refuses a time that has already passed today, but not every week", () => {
    const evening = new Date(2026, 10, 17, 19, 0);
    const r = buildQuickPost({ ...base, timeId: "morning" }, profile, evening);
    expect(r).toEqual({
      ok: false,
      error: "Morning has already passed today. Pick another time or day.",
    });
    expect(buildQuickPost({ ...base, timeId: "morning", weekly: true }, profile, evening).ok).toBe(
      true,
    );
  });

  it("refuses a past date and an unknown time", () => {
    expect(
      buildQuickPost({ ...base, day: { date: "2026-11-01" } }, profile, tuesdayMorning),
    ).toEqual({
      ok: false,
      error: "Pick today or a later day.",
    });
    expect(buildQuickPost({ ...base, timeId: "nope" }, profile, tuesdayMorning).ok).toBe(false);
  });

  it("the travel radius is a whole number of kilometres, as the database column requires", () => {
    const r = buildQuickPost(base, profile, tuesdayMorning);
    expect(r.ok && Number.isInteger(r.payload.travel_radius_km)).toBe(true);
  });

  it("a sport without a profile level is open to all levels; no city saves none", () => {
    const r = buildQuickPost({ ...base, sport: "Soccer", city: "  " }, profile, tuesdayMorning);
    expect(r.ok && r.payload).toMatchObject({
      sports: ["Soccer"],
      skill_level: "All Levels",
      city: null,
    });
  });
});
