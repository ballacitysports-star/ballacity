import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOCATION_ANALYTICS_DEFAULT_DAYS,
  LOCATION_ANALYTICS_TIMEFRAMES,
  LOCATION_DENIAL_RETENTION_DAYS,
  locationAnalyticsDays,
} from "./location-analytics";

describe("location analytics timeframes", () => {
  it("keeps the window inside the 90 days the purge leaves", () => {
    expect(LOCATION_DENIAL_RETENTION_DAYS).toBe(90);
    for (const n of LOCATION_ANALYTICS_TIMEFRAMES) expect(n).toBeLessThanOrEqual(90);
  });

  it("offers the default timeframe", () => {
    expect(LOCATION_ANALYTICS_TIMEFRAMES).toContain(LOCATION_ANALYTICS_DEFAULT_DAYS);
  });

  it("clamps a longer window to 90 days and falls back to the default for a bad one", () => {
    expect(locationAnalyticsDays("180")).toBe(90);
    expect(locationAnalyticsDays("90")).toBe(90);
    expect(locationAnalyticsDays("7")).toBe(7);
    expect(locationAnalyticsDays("")).toBe(LOCATION_ANALYTICS_DEFAULT_DAYS);
    expect(locationAnalyticsDays("-5")).toBe(LOCATION_ANALYTICS_DEFAULT_DAYS);
  });

  it("builds the page's options from the list, with no fixed option past 90 days", () => {
    // Read the route source, as the other page pins do: the page needs auth and a live client.
    const page = readFileSync("src/routes/admin.location-analytics.tsx", "utf8");
    expect(page).toContain("LOCATION_ANALYTICS_TIMEFRAMES.map(");
    const fixed = [...page.matchAll(/<SelectItem value="(\d+)"/g)].map((m) => Number(m[1]));
    for (const n of fixed) expect(n).toBeLessThanOrEqual(90);
    expect(page).not.toMatch(/180 days/);
  });
});
