import { describe, expect, it } from "vitest";
import { money, duration } from "@/lib/ai-admin-format";

describe("money", () => {
  it("keeps sub-cent spend legible instead of rounding it to a lie", () => {
    // Production's 30-day spend at the time of writing was 0.5682 cents.
    // `toFixed(2)` would render that as "$0.01", a number that is 76% wrong on
    // the one page whose job is to report what is really happening.
    expect(money(0.5682)).toBe("$0.0057");
    expect(money(0.01)).toBe("$0.00010");
  });

  it("rounds normally once there is real money involved", () => {
    expect(money(100)).toBe("$1.00");
    expect(money(1234)).toBe("$12.34");
    expect(money(1)).toBe("$0.01");
    expect(money(123456)).toBe("$1234.56");
  });

  it("shows exact zero plainly", () => {
    expect(money(0)).toBe("$0.00");
  });
});

describe("duration", () => {
  it("shows missing latency as a dash rather than zero", () => {
    // No finished jobs is not the same as instant jobs.
    expect(duration(null)).toBe("—");
    expect(duration(undefined)).toBe("—");
  });

  it("keeps millisecond calls out of a 0s bucket", () => {
    expect(duration(0)).toBe("0ms");
    expect(duration(420)).toBe("420ms");
    expect(duration(999)).toBe("999ms");
  });

  it("switches to seconds with one decimal", () => {
    expect(duration(1000)).toBe("1.0s");
    expect(duration(4198)).toBe("4.2s");
    expect(duration(8419)).toBe("8.4s");
  });
});
