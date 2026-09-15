import { describe, expect, it } from "vitest";
import {
  applyTimeToAll,
  defaultEndTime,
  entryDurationMin,
  formatScheduleSummary,
  normalizeSchedule,
  scheduleToPlans,
  setScheduleAllDay,
  setScheduleEndTime,
  setScheduleTime,
  setRangeDuration,
  toggleScheduleDate,
  validateSchedule,
  validateWhenRange,
  whenRangeDurationMin,
  whenRangeToPlan,
  type WhenRange,
} from "./game-schedule";

describe("game-schedule", () => {
  it("sorts, dedupes and fills default end times", () => {
    expect(
      normalizeSchedule([
        { date: "2030-05-10", time: "19:00" },
        { date: "2030-05-01", time: "bad" },
        { date: "2030-05-10", time: "20:00" },
        { date: "nope", time: "10:00" },
      ]),
    ).toEqual([
      { date: "2030-05-01", time: "18:00", endTime: "19:30", allDay: false },
      { date: "2030-05-10", time: "20:00", endTime: "21:30", allDay: false },
    ]);
  });

  it("toggling copies the last day's hours and removes on second tap", () => {
    const a = toggleScheduleDate([], "2030-05-01");
    const b = toggleScheduleDate(setScheduleEndTime(a, "2030-05-01", "09:00"), "2030-05-03");
    expect(b.map((e) => [e.date, e.time, e.endTime])).toEqual([
      ["2030-05-01", "18:00", "09:00"],
      ["2030-05-03", "18:00", "09:00"],
    ]);
    expect(toggleScheduleDate(b, "2030-05-01")).toHaveLength(1);
  });

  it("moving a start keeps the same length", () => {
    const s = normalizeSchedule([{ date: "2030-05-01", time: "18:00", endTime: "20:00" }]);
    const moved = setScheduleTime(s, "2030-05-01", "07:30");
    expect(moved[0]!.endTime).toBe("09:30");
  });

  it("computes lengths, wrapping past midnight, and all-day", () => {
    expect(entryDurationMin({ date: "2030-05-01", time: "18:00", endTime: "20:15" })).toBe(135);
    expect(entryDurationMin({ date: "2030-05-01", time: "22:00", endTime: "01:00" })).toBe(180);
    expect(entryDurationMin({ date: "2030-05-01", time: "22:00", allDay: true })).toBe(1440);
    expect(defaultEndTime("23:00")).toBe("00:30");
  });

  it("applies one day's hours to all days", () => {
    const s = normalizeSchedule([
      { date: "2030-05-01", time: "07:30", endTime: "09:00" },
      { date: "2030-05-02", time: "19:00", endTime: "21:00" },
    ]);
    const all = applyTimeToAll(s, { time: "12:00", endTime: "14:00", allDay: false });
    expect(all.every((e) => e.time === "12:00" && e.endTime === "14:00")).toBe(true);
  });

  it("validates emptiness, past days and zero-length days", () => {
    expect(validateSchedule([]).ok).toBe(false);
    expect(validateSchedule([{ date: "2020-01-01", time: "18:00" }]).ok).toBe(false);
    expect(validateSchedule([{ date: "2030-01-01", time: "18:00" }]).ok).toBe(true);
    expect(validateSchedule([{ date: "2030-01-01", time: "18:00", endTime: "18:00" }]).ok).toBe(
      false,
    );
    expect(
      validateSchedule(
        setScheduleAllDay([{ date: "2030-01-01", time: "18:00" }], "2030-01-01", true),
      ).ok,
    ).toBe(true);
  });

  it("produces one start + length per day", () => {
    const plans = scheduleToPlans([
      { date: "2030-05-02", time: "19:00", endTime: "21:00" },
      { date: "2030-05-01", time: "07:30", endTime: "08:00" },
    ]);
    expect(plans).toHaveLength(2);
    expect(new Date(plans[0]!.startIso) < new Date(plans[1]!.startIso)).toBe(true);
    expect(plans[0]!.durationMin).toBe(30);
    expect(plans[1]!.durationMin).toBe(120);
  });

  it("summarises the schedule", () => {
    expect(formatScheduleSummary([{ date: "2030-05-01", time: "18:00" }])).toContain(
      "Creates 1 game",
    );
  });
});

describe("when range", () => {
  const base: WhenRange = {
    startDate: "2030-05-01",
    startTime: "18:00",
    endDate: "2030-05-01",
    endTime: "20:00",
    allDay: false,
  };

  it("measures the window, including overnight spans", () => {
    expect(whenRangeDurationMin(base)).toBe(120);
    expect(whenRangeDurationMin({ ...base, endDate: "2030-05-02", endTime: "01:00" })).toBe(420);
  });

  it("all-day spans whole days", () => {
    expect(whenRangeDurationMin({ ...base, allDay: true })).toBe(1440);
    expect(whenRangeDurationMin({ ...base, endDate: "2030-05-02", allDay: true })).toBe(2880);
  });

  it("length presets move the end", () => {
    const next = setRangeDuration(base, 180);
    expect(next.endTime).toBe("21:00");
    expect(next.endDate).toBe("2030-05-01");
    const wrapped = setRangeDuration({ ...base, startTime: "23:00" }, 180);
    expect(wrapped.endDate).toBe("2030-05-02");
    expect(wrapped.endTime).toBe("02:00");
  });

  it("rejects ends at or before the start and past start dates", () => {
    expect(validateWhenRange(base, new Date("2030-04-01T00:00:00")).ok).toBe(true);
    expect(
      validateWhenRange({ ...base, endTime: "18:00" }, new Date("2030-04-01T00:00:00")).ok,
    ).toBe(false);
    expect(validateWhenRange(base, new Date("2031-01-01T00:00:00")).ok).toBe(false);
  });

  it("publishes a start plus length", () => {
    const plan = whenRangeToPlan(base);
    expect(plan.durationMin).toBe(120);
    expect(new Date(plan.startIso).getHours()).toBe(18);
  });
});
