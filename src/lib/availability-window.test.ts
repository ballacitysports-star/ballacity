import { describe, expect, it } from "vitest";
import { ANY_TIME_DAYS, availabilityWindowFor } from "./availability-window";

// Tuesday 17 November 2026, 10:00 local time.
const tuesday = new Date(2026, 10, 17, 10, 0);

describe("availabilityWindowFor", () => {
  it("today: from now to local midnight", () => {
    expect(availabilityWindowFor("today", tuesday)).toEqual({
      from: tuesday,
      to: new Date(2026, 10, 18),
    });
  });

  it("this week: the next seven days", () => {
    const w = availabilityWindowFor("week", tuesday);
    expect(w.to.getTime() - w.from.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it("weekend on a weekday: all of Saturday and Sunday", () => {
    expect(availabilityWindowFor("weekend", tuesday)).toEqual({
      from: new Date(2026, 10, 21),
      to: new Date(2026, 10, 23),
    });
  });

  it("weekend on Saturday or Sunday: from now to the end of Sunday", () => {
    const sat = new Date(2026, 10, 21, 15, 0);
    const sun = new Date(2026, 10, 22, 9, 0);
    expect(availabilityWindowFor("weekend", sat)).toEqual({
      from: sat,
      to: new Date(2026, 10, 23),
    });
    expect(availabilityWindowFor("weekend", sun)).toEqual({
      from: sun,
      to: new Date(2026, 10, 23),
    });
  });

  it("any time: two weeks ahead, inside the server's 31-day limit", () => {
    const w = availabilityWindowFor("any", tuesday);
    expect(w.to.getTime() - w.from.getTime()).toBe(ANY_TIME_DAYS * 24 * 3600 * 1000);
    expect(ANY_TIME_DAYS).toBeLessThanOrEqual(31);
  });
});
