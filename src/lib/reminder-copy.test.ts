import { describe, expect, it } from "vitest";
import { REMINDER_PRESETS, formatDuration } from "./datetime";
import { DEFAULT_GAME_REMINDER_OFFSETS } from "./game-reminders";
import { reminderLeadLabel, reminderLeadSummary } from "./reminder-copy";

describe("reminder lead copy", () => {
  it('reads "1 day before", not "All day before"', () => {
    expect(reminderLeadLabel(1440)).toBe("1 day before");
    expect(reminderLeadLabel(1440)).not.toMatch(/all day/i);
    // formatDuration keeps "All day" for event lengths; only the reminder copy changes.
    expect(formatDuration(1440)).toBe("All day");
  });

  it("matches every preset chip's label", () => {
    for (const p of REMINDER_PRESETS) expect(reminderLeadLabel(p.min)).toBe(p.label);
    expect(reminderLeadLabel(10080)).toBe("1 week before");
  });

  it("falls back to the duration for a non-preset offset", () => {
    expect(reminderLeadLabel(60)).toBe("1h before");
    expect(reminderLeadLabel(2880)).toBe("2 days before");
  });

  it("summarises the default offsets", () => {
    expect(reminderLeadSummary(DEFAULT_GAME_REMINDER_OFFSETS)).toBe(
      "1 day before and 2 hours before",
    );
    expect(reminderLeadSummary([])).toBe("");
  });
});
