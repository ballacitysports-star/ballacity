import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNT,
  MAX_OCCURRENCES,
  describeRule,
  expandRecurrence,
  normalizeRule,
  toggleException,
} from "./recurrence";

describe("expandRecurrence", () => {
  it("returns just the start when not repeating", () => {
    expect(expandRecurrence("2026-09-05", { freq: "none" })).toEqual(["2026-09-05"]);
  });

  it("expands daily with a count", () => {
    expect(expandRecurrence("2026-09-05", { freq: "daily", count: 3 })).toEqual([
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
    ]);
  });

  it("expands weekly on chosen weekdays", () => {
    // 2026-09-07 is a Monday.
    const out = expandRecurrence("2026-09-07", { freq: "weekly", weekdays: [1, 3], count: 4 });
    expect(out).toEqual(["2026-09-07", "2026-09-09", "2026-09-14", "2026-09-16"]);
  });

  it("uses the start weekday when none are given", () => {
    const out = expandRecurrence("2026-09-05", { freq: "weekly", count: 3 });
    expect(out).toEqual(["2026-09-05", "2026-09-12", "2026-09-19"]);
  });

  it("strides two weeks for biweekly", () => {
    const out = expandRecurrence("2026-09-05", { freq: "biweekly", count: 3 });
    expect(out).toEqual(["2026-09-05", "2026-09-19", "2026-10-03"]);
  });

  it("repeats the same weekday-of-month for monthly", () => {
    // 2026-09-05 is the first Saturday.
    const out = expandRecurrence("2026-09-05", { freq: "monthly", count: 3 });
    expect(out).toEqual(["2026-09-05", "2026-10-03", "2026-11-07"]);
  });

  it("stops at the until date", () => {
    const out = expandRecurrence("2026-09-05", { freq: "daily", until: "2026-09-07" });
    expect(out).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });

  it("drops exception dates", () => {
    const out = expandRecurrence("2026-09-05", {
      freq: "daily",
      count: 3,
      exceptions: ["2026-09-06"],
    });
    expect(out).toEqual(["2026-09-05", "2026-09-07"]);
  });

  it("defaults to a bounded number of occurrences", () => {
    expect(expandRecurrence("2026-09-05", { freq: "weekly" })).toHaveLength(DEFAULT_COUNT);
  });

  it("never exceeds the hard cap", () => {
    const out = expandRecurrence("2026-01-01", { freq: "daily", count: 999 });
    expect(out.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
  });

  it("ignores malformed start keys", () => {
    expect(expandRecurrence("nope", { freq: "daily", count: 3 })).toEqual([]);
  });
});

describe("normalizeRule", () => {
  it("dedupes and sorts weekdays and clamps count", () => {
    const r = normalizeRule({ freq: "weekly", weekdays: [3, 1, 3, 9], count: 500 });
    expect(r.weekdays).toEqual([1, 3]);
    expect(r.count).toBe(MAX_OCCURRENCES);
  });
});

describe("toggleException", () => {
  it("adds then removes a skipped date", () => {
    const once = toggleException({ freq: "daily" }, "2026-09-06");
    expect(once.exceptions).toEqual(["2026-09-06"]);
    expect(toggleException(once, "2026-09-06").exceptions).toEqual([]);
  });
});

describe("describeRule", () => {
  it("summarizes a weekly rule", () => {
    expect(describeRule({ freq: "weekly", weekdays: [1, 3], count: 8 })).toBe(
      "Every week on Mon, Wed · 8 times",
    );
  });

  it("summarizes no repeat", () => {
    expect(describeRule({ freq: "none" })).toBe("Does not repeat");
  });
});
