import { describe, expect, it } from "vitest";
import { formatGameWhen } from "./format";

describe("formatGameWhen", () => {
  const iso = "2026-09-05T22:00:00Z";

  it("shows a clock time for timed games", () => {
    expect(formatGameWhen({ date: iso })).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it("never shows a clock time for all-day games", () => {
    const label = formatGameWhen({ date: iso, allDay: true });
    expect(label).toContain("All day");
    expect(label).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
