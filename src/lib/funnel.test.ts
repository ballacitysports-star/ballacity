import { describe, expect, it } from "vitest";
import {
  FUNNEL_COUNT_KEYS,
  FUNNEL_ROWS,
  formatFunnelCount,
  formatFunnelPct,
  formatFunnelWeek,
  funnelToday,
  funnelWindowFrom,
  maskFunnelCount,
  parseFunnelReport,
  readFunnelCount,
} from "./funnel";

/** One group as superadmin_funnel sends it: every count, then the two rates. */
function rawGroup(over: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(FUNNEL_COUNT_KEYS.map((k) => [k, 0])),
    marked_coverage_pct: null,
    show_up_rate_pct: null,
    ...over,
  };
}

function rawReport(over: Record<string, unknown> = {}, week: Record<string, unknown> = {}) {
  return {
    timezone: "America/New_York",
    from: "2026-11-16",
    to: "2026-11-21",
    pilot_start: null,
    minors_column: false,
    history: { available: true, frozen_before: "2026-10-26", days_used: 0 },
    weeks: [
      {
        week_start: "2026-11-16",
        first_day: "2026-11-16",
        last_day: "2026-11-21",
        source: "live",
        adults: rawGroup({ posters: 12, invites_sent: "<5" }),
        ...week,
      },
    ],
    ...over,
  };
}

describe("funnel counts", () => {
  it("masks 1 to 4 as <5 with maskSmallCount's threshold, and keeps 0 and 5", () => {
    expect(maskFunnelCount(0)).toEqual({ value: 0, small: false });
    expect(maskFunnelCount(1)).toEqual({ value: null, small: true });
    expect(maskFunnelCount(4)).toEqual({ value: null, small: true });
    expect(maskFunnelCount(5)).toEqual({ value: 5, small: false });
  });

  it("reads the server's values and masks a raw small count again", () => {
    expect(readFunnelCount("<5")).toEqual({ value: null, small: true });
    expect(readFunnelCount(3)).toEqual({ value: null, small: true });
    expect(readFunnelCount(17)).toEqual({ value: 17, small: false });
    expect(readFunnelCount(-1)).toBeNull();
    expect(readFunnelCount("12")).toBeNull();
    expect(readFunnelCount(2.5)).toBeNull();
  });

  it("formats counts and rates", () => {
    expect(formatFunnelCount({ value: null, small: true })).toBe("<5");
    expect(formatFunnelCount({ value: 0, small: false })).toBe("0");
    expect(formatFunnelCount(null)).toBe("–");
    expect(formatFunnelPct(83)).toBe("83%");
    expect(formatFunnelPct(null)).toBe("–");
  });

  it("names every count the server returns, once, in the plan's order", () => {
    expect(FUNNEL_ROWS.map((r) => r.key).sort()).toEqual([...FUNNEL_COUNT_KEYS].sort());
    expect(FUNNEL_ROWS.filter((r) => r.step).map((r) => r.step)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
  });
});

describe("parseFunnelReport", () => {
  it("reads a week with masked counts and the rates", () => {
    const r = parseFunnelReport(
      rawReport(
        {},
        { adults: rawGroup({ posters: 12, invites_sent: "<5", show_up_rate_pct: 83 }) },
      ),
    );
    expect(r?.weeks[0]?.adults.posters).toEqual({ value: 12, small: false });
    expect(r?.weeks[0]?.adults.invites_sent).toEqual({ value: null, small: true });
    expect(r?.weeks[0]?.adults.showUpRatePct).toBe(83);
    expect(r?.weeks[0]?.adults.markedCoveragePct).toBeNull();
    expect(r?.history).toEqual({ available: true, frozenBefore: "2026-10-26" });
  });

  it("drops an under-18 column the switch does not allow", () => {
    const r = parseFunnelReport(rawReport({}, { not_confirmed_adult: rawGroup({ posters: 9 }) }));
    expect(r?.minorsColumn).toBe(false);
    expect(r?.weeks[0]?.notConfirmedAdult).toBeUndefined();
  });

  it("keeps it while the switch is on", () => {
    const r = parseFunnelReport(
      rawReport({ minors_column: true }, { not_confirmed_adult: rawGroup({ posters: "<5" }) }),
    );
    expect(r?.weeks[0]?.notConfirmedAdult?.posters).toEqual({ value: null, small: true });
  });

  it("refuses a shape it does not know", () => {
    expect(parseFunnelReport(null)).toBeNull();
    expect(parseFunnelReport({ weeks: [] })).toBeNull();
    expect(parseFunnelReport(rawReport({}, { adults: { posters: 1 } }))).toBeNull();
    expect(parseFunnelReport(rawReport({}, { adults: rawGroup({ posters: "many" }) }))).toBeNull();
  });
});

describe("dates", () => {
  it("labels a week by the days it covers, read as written", () => {
    expect(formatFunnelWeek({ firstDay: "2026-11-16", lastDay: "2026-11-22" })).toBe("Nov 16 – 22");
    expect(formatFunnelWeek({ firstDay: "2026-11-30", lastDay: "2026-12-06" })).toBe(
      "Nov 30 – Dec 6",
    );
    expect(formatFunnelWeek({ firstDay: "2026-11-16", lastDay: "2026-11-16" })).toBe("Nov 16");
  });

  it("starts a window of n weeks n-1 weeks before today", () => {
    const today = new Date("2026-11-21T15:00:00Z");
    expect(funnelWindowFrom(8, today)).toBe("2026-10-03");
    expect(funnelWindowFrom(1, today)).toBe("2026-11-21");
  });

  it("counts from the New York date, as the database does, not the UTC one", () => {
    // Sunday 22:00 in New York is already Monday in UTC: four weeks must still mean four week columns.
    const sundayNight = new Date("2026-11-30T03:00:00Z");
    expect(funnelToday(sundayNight)).toBe("2026-11-29");
    expect(funnelWindowFrom(4, sundayNight)).toBe("2026-11-08");
    expect(funnelWindowFrom(8, sundayNight)).toBe("2026-10-11");
    // Just after midnight in New York (05:00 UTC in winter, 04:00 in summer).
    expect(funnelToday(new Date("2026-11-30T05:00:00Z"))).toBe("2026-11-30");
    expect(funnelToday(new Date("2026-07-01T03:59:00Z"))).toBe("2026-06-30");
    expect(funnelToday(new Date("2026-07-01T04:00:00Z"))).toBe("2026-07-01");
  });
});
