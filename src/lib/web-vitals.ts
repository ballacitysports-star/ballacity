/**
 * P0-8 (second half): Core Web Vitals to GA4, through the same funnel as every other event.
 *
 * The rules come from `analytics.ts`, so they hold here too:
 *   * adults only (the reporter is started only once the member is confirmed to be an adult, and
 *     `trackEvent` still refuses to send for anyone else);
 *   * no personal data: the metric name, a rounded value, Google's rating, how the page was reached,
 *     and the route as a path with ids masked (the same masking as error reports), never a full URL.
 *
 * The `web-vitals` library is loaded only when reporting starts, so minors and signed-out visitors
 * never download it. Its observers read buffered entries, so starting late still reports LCP, FCP,
 * TTFB and CLS for the page that was loaded.
 */
import { trackEvent } from "@/lib/analytics";
import { scrubRoute } from "@/lib/error-report";

export const VITAL_NAMES = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

/** The subset of a web-vitals Metric this module reads. */
export type VitalMetric = {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
};

const RATINGS = new Set(["good", "needs-improvement", "poor"]);
const NAV_TYPES = new Set([
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
]);

/**
 * The parameters sent for one metric, or null for anything unexpected. CLS is a unitless score, so it
 * is sent times 1000 (GA4 values are whole numbers); the others are milliseconds.
 */
export function vitalParams(
  metric: VitalMetric,
  pathname: string,
): { metric: VitalName; value: number; rating: string; nav: string; route: string } | null {
  if (!(VITAL_NAMES as readonly string[]).includes(metric.name)) return null;
  if (typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value < 0) {
    return null;
  }
  const name = metric.name as VitalName;
  return {
    metric: name,
    value: Math.round(name === "CLS" ? metric.value * 1000 : metric.value),
    rating: metric.rating && RATINGS.has(metric.rating) ? metric.rating : "unknown",
    nav:
      metric.navigationType && NAV_TYPES.has(metric.navigationType)
        ? metric.navigationType
        : "other",
    route: scrubRoute(pathname) ?? "/",
  };
}

export function reportVital(metric: VitalMetric, pathname = currentPath()) {
  const params = vitalParams(metric, pathname);
  if (params) trackEvent("web_vital", params);
}

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

let started = false;

/** Starts reporting, once per page load. A no-op on the server. */
export async function startWebVitals(): Promise<void> {
  if (typeof window === "undefined" || started) return;
  started = true;
  try {
    const { onLCP, onINP, onCLS, onFCP, onTTFB } = await import("web-vitals");
    const report = (m: VitalMetric) => reportVital(m);
    onLCP(report);
    onINP(report);
    onCLS(report);
    onFCP(report);
    onTTFB(report);
  } catch {
    // Reporting must never break the app.
  }
}

/** Test seam. */
export function __resetWebVitalsForTests() {
  started = false;
}
