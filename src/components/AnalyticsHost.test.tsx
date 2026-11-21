// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

/**
 * P1-9: the navigation decision is read from GA4, so only the published build may
 * send to it. Development builds (vite dev, the Playwright dev server, Lovable's
 * live preview) load no tag and do not even run the age check.
 */

const h = vi.hoisted(() => ({
  ageCalls: [] as boolean[],
  loaded: [] as string[],
  audience: [] as boolean[],
  cohort: "adult" as "adult" | "teen_16_17",
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1", created_at: "2020-01-01T00:00:00Z", app_metadata: {} },
    loading: false,
  }),
}));
vi.mock("@/lib/age-verification", () => ({
  useMyAgeStatus: (enabled: boolean) => {
    h.ageCalls.push(enabled);
    return { data: { cohort: h.cohort, reviewRequired: false } };
  },
}));
vi.mock("@/lib/analytics", () => ({
  loadAnalyticsTag: (id: string) => h.loaded.push(id),
  setAnalyticsAudience: (on: boolean) => h.audience.push(on),
  trackEvent: () => {},
}));
vi.mock("@/lib/web-vitals", () => ({ startWebVitals: async () => {} }));

const { AnalyticsHost, analyticsMeasurementId } = await import("./AnalyticsHost");

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  h.ageCalls.length = 0;
  h.loaded.length = 0;
  h.audience.length = 0;
  h.cohort = "adult";
});

describe("AnalyticsHost", () => {
  it("loads nothing in a development build, even with an id configured", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST");
    expect(analyticsMeasurementId()).toBe("");
    render(<AnalyticsHost />);
    expect(h.loaded).toEqual([]);
    expect(h.ageCalls).toEqual([]);
    expect(h.audience).toEqual([]);
  });

  it("loads the tag for a confirmed adult in the published build", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST");
    render(<AnalyticsHost />);
    expect(h.loaded).toEqual(["G-TEST"]);
    expect(h.audience.at(-1)).toBe(true);
  });

  it("keeps the audience off and loads nothing for a minor in the published build", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST");
    h.cohort = "teen_16_17";
    render(<AnalyticsHost />);
    expect(h.loaded).toEqual([]);
    expect(h.audience.at(-1)).toBe(false);
  });

  it("does nothing without a measurement id", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    render(<AnalyticsHost />);
    expect(h.loaded).toEqual([]);
    expect(h.ageCalls).toEqual([]);
  });
});
