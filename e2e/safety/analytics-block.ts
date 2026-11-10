/**
 * E2E never talks to Google Analytics.
 *
 * vite.config.ts bakes the production GA4 measurement id into a build unless
 * GOOGLE_ANALYTICS_MEASUREMENT_ID is set, and src/components/AnalyticsHost.tsx loads the
 * gtag tag for signed-in confirmed adults, which the fixture accounts include. The E2E
 * workflow and the dev-server launcher (dev-server.ts) set a dummy id. This is the second
 * layer: every browser context aborts requests to the Google tag hosts before they leave
 * the browser.
 *
 * It is applied by the shared `test` in e2e/helpers/test.ts, which every spec imports
 * instead of `@playwright/test` (a unit test enforces that).
 */
import type { BrowserContext } from "@playwright/test";

/** The hosts gtag.js is loaded from and sends events to. Subdomains are blocked too. */
export const BLOCKED_ANALYTICS_HOSTS = ["googletagmanager.com", "google-analytics.com"] as const;

/** Any http(s) or ws(s) URL on a blocked host or one of its subdomains. */
export const BLOCKED_ANALYTICS_URL =
  /^(?:https?|wss?):\/\/(?:[^/?#@]*\.)?(?:googletagmanager\.com|google-analytics\.com)(?::\d+)?(?:[/?#]|$)/i;

/** Abort every request a context makes to a blocked host. Call before any page opens. */
export async function blockAnalytics(context: BrowserContext): Promise<void> {
  await context.route(BLOCKED_ANALYTICS_URL, (route) => route.abort("blockedbyclient"));
}
