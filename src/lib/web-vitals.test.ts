// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const handlers: Record<string, (m: unknown) => void> = {};
vi.mock("web-vitals", () => ({
  onLCP: (cb: (m: unknown) => void) => (handlers.LCP = cb),
  onINP: (cb: (m: unknown) => void) => (handlers.INP = cb),
  onCLS: (cb: (m: unknown) => void) => (handlers.CLS = cb),
  onFCP: (cb: (m: unknown) => void) => (handlers.FCP = cb),
  onTTFB: (cb: (m: unknown) => void) => (handlers.TTFB = cb),
}));

import { setAnalyticsAudience } from "./analytics";
import { __resetWebVitalsForTests, startWebVitals, vitalParams } from "./web-vitals";

describe("vitalParams", () => {
  it("sends the metric, a rounded value, the rating, how the page was reached and a masked route", () => {
    expect(
      vitalParams(
        { name: "LCP", value: 2412.6, rating: "good", navigationType: "navigate" },
        "/games/3f2a9c1e-1111-4222-8333-944455556666",
      ),
    ).toEqual({ metric: "LCP", value: 2413, rating: "good", nav: "navigate", route: "/games/:id" });
  });

  it("scales CLS to a whole number", () => {
    expect(vitalParams({ name: "CLS", value: 0.0734, rating: "good" }, "/")?.value).toBe(73);
  });

  it("drops unknown metrics and bad values, and never passes free text through", () => {
    expect(vitalParams({ name: "FID", value: 10 }, "/")).toBeNull();
    expect(vitalParams({ name: "LCP", value: Number.NaN }, "/")).toBeNull();
    expect(vitalParams({ name: "LCP", value: -1 }, "/")).toBeNull();
    const p = vitalParams(
      { name: "INP", value: 120, rating: "me@x.com", navigationType: "<script>" },
      "/players/someone@example.com?token=abc",
    );
    expect(p).toEqual({
      metric: "INP",
      value: 120,
      rating: "unknown",
      nav: "other",
      route: "/players/:id",
    });
  });
});

describe("startWebVitals", () => {
  const gtag = vi.fn();
  beforeEach(() => {
    gtag.mockReset();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    __resetWebVitalsForTests();
    for (const k of Object.keys(handlers)) delete handlers[k];
  });
  afterEach(() => setAnalyticsAudience(false));

  it("registers each metric once and sends through the adult-only funnel", async () => {
    setAnalyticsAudience(true);
    await startWebVitals();
    await startWebVitals();
    expect(Object.keys(handlers).sort()).toEqual(["CLS", "FCP", "INP", "LCP", "TTFB"]);
    window.history.pushState({}, "", "/teams/123456");
    handlers.INP({ name: "INP", value: 88, rating: "good", navigationType: "navigate" });
    expect(gtag).toHaveBeenCalledWith("event", "web_vital", {
      metric: "INP",
      value: 88,
      rating: "good",
      nav: "navigate",
      route: "/teams/:id",
    });
  });

  it("sends nothing for anyone not confirmed to be an adult", async () => {
    setAnalyticsAudience(false);
    await startWebVitals();
    handlers.LCP({ name: "LCP", value: 1000, rating: "good" });
    expect(gtag).not.toHaveBeenCalled();
  });
});

describe("AnalyticsHost", () => {
  it("starts web vitals only after the adult check, next to loading the tag", () => {
    const src = readFileSync("src/components/AnalyticsHost.tsx", "utf8");
    const notAdult = src.indexOf("if (!isAdult) return;");
    const start = src.indexOf("startWebVitals()");
    expect(notAdult).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(notAdult);
  });
});
