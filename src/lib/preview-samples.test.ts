import { describe, expect, it } from "vitest";
import {
  PREVIEW_CONFIGS,
  SAMPLE_GYMS,
  SAMPLE_REELS,
  daysUntilWeekday,
  sampleDay,
} from "./preview-samples";

// Thursday, October 22 2026 (UTC).
const THU = new Date(Date.UTC(2026, 9, 22, 15, 0, 0));
const DATE =
  /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/;
const TIME = /\d{1,2}(:\d{2})?( ?[AP]M)?(–| · )?/;

describe("sampleDay", () => {
  it("names the day offset from a date, across a month end", () => {
    expect(sampleDay(0, THU)).toBe("Thu, Oct 22");
    expect(sampleDay(3, THU)).toBe("Sun, Oct 25");
    expect(sampleDay(10, THU)).toBe("Sun, Nov 1");
    expect(sampleDay(-1, THU)).toBe("Wed, Oct 21");
  });

  it("does not depend on the machine's time zone", () => {
    const lateUtc = new Date(Date.UTC(2026, 9, 22, 23, 59, 0));
    expect(sampleDay(0, lateUtc)).toBe("Thu, Oct 22");
  });
});

describe("daysUntilWeekday", () => {
  it("is always ahead: the same weekday means next week, never today", () => {
    expect(daysUntilWeekday(4, THU)).toBe(7);
    expect(daysUntilWeekday(5, THU)).toBe(1);
    expect(daysUntilWeekday(0, THU)).toBe(3);
    expect(daysUntilWeekday(3, THU)).toBe(6);
  });
});

describe("sample content has specific dates and times", () => {
  const rowsOf = (tab: keyof typeof PREVIEW_CONFIGS) => PREVIEW_CONFIGS[tab].rows ?? [];

  it("pickup games show a date, a time window and spots left", () => {
    for (const r of rowsOf("feed")) {
      expect(r.detail).toMatch(DATE);
      expect(r.detail).toMatch(/\d{1,2}:\d{2} [AP]M–\d{1,2}:\d{2} [AP]M/);
      expect(r.chips?.some((c) => /spots? open/.test(c))).toBe(true);
    }
  });

  it("player availability lists dated time windows", () => {
    for (const r of rowsOf("players")) {
      expect(r.chips?.length).toBeGreaterThanOrEqual(2);
      for (const c of r.chips ?? []) {
        expect(c).toMatch(DATE);
        expect(c).toMatch(TIME);
      }
    }
  });

  it("trainers list dated open session slots with a price", () => {
    for (const r of rowsOf("trainers")) {
      expect(r.detail).toMatch(/\$\d+/);
      expect(r.chips?.length).toBeGreaterThanOrEqual(2);
      for (const c of r.chips ?? []) expect(c).toMatch(DATE);
    }
  });

  it("gyms show opening hours and dated free court times", () => {
    expect(SAMPLE_GYMS.length).toBeGreaterThan(0);
    for (const r of SAMPLE_GYMS) {
      expect(r.detail).toMatch(/Open today \d{1,2}:\d{2} [AP]M–\d{1,2}:\d{2} [AP]M/);
      expect(r.chips?.some((c) => DATE.test(c))).toBe(true);
    }
  });

  it("teams show their next practice or game", () => {
    for (const r of rowsOf("teams")) expect(r.detail).toMatch(DATE);
  });

  it("reels show length, posted date and counts; messages show a time or day", () => {
    expect(SAMPLE_REELS.length).toBeGreaterThanOrEqual(8);
    for (const r of rowsOf("reels")) {
      expect(r.detail).toMatch(/\d:\d{2} · Posted /);
      expect(r.detail).toMatch(DATE);
      expect(r.chips).toHaveLength(2);
    }
    for (const r of rowsOf("messages")) expect(r.detail).toMatch(/\d|ago|Yesterday/);
    const convo = PREVIEW_CONFIGS.messages.locked?.lines ?? [];
    expect(convo.length).toBeGreaterThanOrEqual(3);
    for (const l of convo) expect(l).toMatch(/\d{1,2}:\d{2} [AP]M/);
  });

  it("every row title is unique (they are React keys)", () => {
    for (const tab of Object.keys(PREVIEW_CONFIGS) as (keyof typeof PREVIEW_CONFIGS)[]) {
      const titles = rowsOf(tab).map((r) => r.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
    expect(new Set(SAMPLE_GYMS.map((r) => r.title)).size).toBe(SAMPLE_GYMS.length);
  });
});
