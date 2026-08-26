import { describe, expect, it } from "vitest";
import {
  applyTimeToAll,
  formatScheduleSummary,
  normalizeSchedule,
  scheduleToIsoDates,
  setScheduleTime,
  toggleScheduleDate,
  validateSchedule,
} from "./game-schedule";

describe("game-schedule", () => {
  it("sorts, dedupes and defaults times", () => {
    expect(
      normalizeSchedule([
        { date: "2030-05-10", time: "19:00" },
        { date: "2030-05-01", time: "bad" },
        { date: "2030-05-10", time: "20:00" },
        { date: "nope", time: "10:00" },
      ]),
    ).toEqual([
      { date: "2030-05-01", time: "18:00" },
      { date: "2030-05-10", time: "20:00" },
    ]);
  });

  it("toggling copies the last day's time and removes on second tap", () => {
    const a = toggleScheduleDate([], "2030-05-01");
    const b = toggleScheduleDate(setScheduleTime(a, "2030-05-01", "07:30"), "2030-05-03");
    expect(b).toEqual([
      { date: "2030-05-01", time: "07:30" },
      { date: "2030-05-03", time: "07:30" },
    ]);
    expect(toggleScheduleDate(b, "2030-05-01")).toHaveLength(1);
  });

  it("keeps per-day times independent until applied to all", () => {
    const s = [
      { date: "2030-05-01", time: "07:30" },
      { date: "2030-05-02", time: "19:00" },
    ];
    expect(applyTimeToAll(s, "12:00").every((e) => e.time === "12:00")).toBe(true);
  });

  it("validates emptiness and past days", () => {
    expect(validateSchedule([]).ok).toBe(false);
    expect(validateSchedule([{ date: "2020-01-01", time: "18:00" }]).ok).toBe(false);
    expect(validateSchedule([{ date: "2030-01-01", time: "18:00" }]).ok).toBe(true);
  });

  it("produces one ISO date per day", () => {
    const iso = scheduleToIsoDates([
      { date: "2030-05-02", time: "19:00" },
      { date: "2030-05-01", time: "07:30" },
    ]);
    expect(iso).toHaveLength(2);
    expect(new Date(iso[0]!) < new Date(iso[1]!)).toBe(true);
  });

  it("summarises the schedule", () => {
    expect(formatScheduleSummary([{ date: "2030-05-01", time: "18:00" }])).toContain(
      "Creates 1 game",
    );
  });
});
