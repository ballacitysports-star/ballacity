import { describe, expect, it } from "vitest";
import {
  backlogTone,
  dayPartLabel,
  dayPartOrder,
  fmtMinutes,
  isStalePending,
  overnightTone,
  STALE_PENDING_DAYS,
  summarizeCohortUsage,
  type ConsentBacklog,
} from "./youth-oversight";

const backlog = (over: Partial<ConsentBacklog> = {}): ConsentBacklog => ({
  required: 0,
  pending: 0,
  revoked: 0,
  approved: 0,
  stalePending: 0,
  oldestPendingAt: null,
  ...over,
});

describe("summarizeCohortUsage", () => {
  it("sums day parts per cohort and isolates overnight minutes", () => {
    const out = summarizeCohortUsage([
      { cohort: "teen_13_15", dayPart: "overnight_00_06", members: 2, avgDailyMinutes: 12.5 },
      { cohort: "teen_13_15", dayPart: "evening_18_24", members: 5, avgDailyMinutes: 30 },
      { cohort: "child_under_13", dayPart: "morning_06_12", members: 1, avgDailyMinutes: 4 },
    ]);
    expect(out.map((c) => c.cohort)).toEqual(["child_under_13", "teen_13_15"]);
    const teen = out[1]!;
    expect(teen.members).toBe(5);
    expect(teen.avgDailyMinutes).toBe(42.5);
    expect(teen.overnightMinutes).toBe(12.5);
    expect(out[0]!.overnightMinutes).toBe(0);
  });

  it("returns an empty list for no rows", () => {
    expect(summarizeCohortUsage([])).toEqual([]);
  });
});

describe("isStalePending", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  it("flags requests older than the threshold", () => {
    expect(isStalePending("2026-09-01T00:00:00Z", now)).toBe(true);
  });
  it("does not flag fresh or missing requests", () => {
    expect(isStalePending("2026-09-09T00:00:00Z", now)).toBe(false);
    expect(isStalePending(null, now)).toBe(false);
    expect(isStalePending("not-a-date", now)).toBe(false);
  });
  it("treats exactly the threshold as not stale", () => {
    const at = new Date(now.getTime() - STALE_PENDING_DAYS * 86_400_000).toISOString();
    expect(isStalePending(at, now)).toBe(false);
  });
});

describe("tones", () => {
  it("is ok with an empty backlog", () => {
    expect(backlogTone(backlog())).toBe("ok");
  });
  it("warns on open work and escalates on stale or revoked", () => {
    expect(backlogTone(backlog({ pending: 2 }))).toBe("warn");
    expect(backlogTone(backlog({ required: 1 }))).toBe("warn");
    expect(backlogTone(backlog({ pending: 2, stalePending: 1 }))).toBe("danger");
    expect(backlogTone(backlog({ revoked: 1 }))).toBe("danger");
  });
  it("grades overnight usage", () => {
    expect(overnightTone([])).toBe("ok");
    expect(
      overnightTone([{ cohort: "teen_13_15", members: 1, avgDailyMinutes: 10, overnightMinutes: 0 }]),
    ).toBe("ok");
    expect(
      overnightTone([{ cohort: "teen_13_15", members: 1, avgDailyMinutes: 10, overnightMinutes: 5 }]),
    ).toBe("warn");
    expect(
      overnightTone([
        { cohort: "teen_13_15", members: 1, avgDailyMinutes: 60, overnightMinutes: 31 },
      ]),
    ).toBe("danger");
  });
});

describe("formatting", () => {
  it("labels and orders day parts, falling back for unknowns", () => {
    expect(dayPartLabel("overnight_00_06")).toContain("Overnight");
    expect(dayPartLabel("mystery")).toBe("mystery");
    expect(dayPartOrder("evening_18_24")).toBe(3);
    expect(dayPartOrder("mystery")).toBe(99);
  });
  it("formats minutes", () => {
    expect(fmtMinutes(0)).toBe("0m");
    expect(fmtMinutes(-3)).toBe("0m");
    expect(fmtMinutes(12.34)).toBe("12.3m");
    expect(fmtMinutes(60)).toBe("1h");
    expect(fmtMinutes(95)).toBe("1h 35m");
  });
});
