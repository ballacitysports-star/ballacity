/**
 * The `test` every spec uses. It is `@playwright/test` with one change: no browser
 * context can reach Google Analytics (see e2e/safety/analytics-block.ts).
 *
 * The block is installed on `browser.newContext`, so it covers the default `context` and
 * `page` fixtures and every context or page a spec creates itself with
 * `browser.newContext()` or `browser.newPage()`.
 *
 * Specs import from here, never from `@playwright/test` directly; a unit test
 * (src/lib/e2e-analytics-block.test.ts) fails if one does.
 */
import { test as base, type Browser } from "@playwright/test";
import { blockAnalytics } from "../safety/analytics-block";

export * from "@playwright/test";

const PATCHED = Symbol.for("ballacity.e2e.analyticsBlocked");

/** Make every context this browser creates abort analytics requests. Idempotent. */
export function installAnalyticsBlock(browser: Browser): Browser {
  const tagged = browser as Browser & { [PATCHED]?: true };
  if (tagged[PATCHED]) return browser;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    await blockAnalytics(context);
    return context;
  };
  tagged[PATCHED] = true;
  return browser;
}

export const test = base.extend<object, { browser: Browser }>({
  browser: [
    async ({ browser }, use) => {
      await use(installAnalyticsBlock(browser));
    },
    { scope: "worker" },
  ],
});
