import { describe, expect, it } from "vitest";
import {
  cancelPolicyNote,
  isLateCancel,
  lateCancelWarning,
  normalizeCutoff,
  sessionStart,
} from "./cancel-window";

const NOW = Date.parse("2026-10-08T18:00:00Z");
const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();

describe("isLateCancel", () => {
  it("is late inside the cutoff and before start", () => {
    expect(isLateCancel(inMin(90), 120, NOW)).toBe(true);
    expect(isLateCancel(inMin(1), 120, NOW)).toBe(true);
    expect(isLateCancel(inMin(120), 120, NOW)).toBe(true);
  });

  it("is not late before the window, after start, or with the cutoff off", () => {
    expect(isLateCancel(inMin(121), 120, NOW)).toBe(false);
    expect(isLateCancel(inMin(0), 120, NOW)).toBe(false);
    expect(isLateCancel(inMin(-30), 120, NOW)).toBe(false);
    expect(isLateCancel(inMin(30), 0, NOW)).toBe(false);
    expect(isLateCancel(null, 120, NOW)).toBe(false);
  });

  it("falls back to the 2-hour default when the cutoff is unknown", () => {
    expect(normalizeCutoff(undefined)).toBe(120);
    expect(isLateCancel(inMin(90), undefined, NOW)).toBe(true);
  });
});

describe("copy", () => {
  it("describes the policy and the late warning", () => {
    expect(cancelPolicyNote(120)).toMatch(/until 2 hours before start/);
    expect(cancelPolicyNote(0)).toMatch(/any time/);
    expect(lateCancelWarning(1440)).toMatch(/less than 1 day before start/);
  });
});

describe("sessionStart", () => {
  it("reads the wall-clock time in the trainer's time zone", () => {
    // 5:30 PM in Los Angeles on Oct 12 (PDT, UTC-7) is 00:30 UTC on Oct 13.
    expect(sessionStart("2026-10-12", "17:30:00", "America/Los_Angeles")?.toISOString()).toBe(
      "2026-10-13T00:30:00.000Z",
    );
  });

  it("is null without a date and time, or with an unknown time zone", () => {
    expect(sessionStart(null, "17:30", "America/Los_Angeles")).toBeNull();
    expect(sessionStart("2026-10-12", null, "America/Los_Angeles")).toBeNull();
    expect(sessionStart("2026-10-12", "17:30", "Not/AZone")).toBeNull();
  });
});
