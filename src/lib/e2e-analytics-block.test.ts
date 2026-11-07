import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Route } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { installAnalyticsBlock, test as sharedTest } from "../../e2e/helpers/test";
import {
  BLOCKED_ANALYTICS_HOSTS,
  BLOCKED_ANALYTICS_URL,
  blockAnalytics,
} from "../../e2e/safety/analytics-block";

/**
 * E2E must never send events to the production GA4 property. Layer one is the dummy
 * measurement id (e2e-dev-server.test.ts, e2e.yml). Layer two, tested here, is the
 * browser: every context Playwright opens aborts requests to the Google tag hosts.
 * e2e/analytics-blocked.spec.ts proves the same in a real browser.
 */

type Handler = (route: Route) => unknown;

function fakeContext() {
  const routes: Array<{ pattern: unknown; handler: Handler }> = [];
  const context = {
    route: vi.fn(async (pattern: unknown, handler: Handler) => {
      routes.push({ pattern, handler });
    }),
  };
  return { context: context as unknown as BrowserContext, routes };
}

function fakeBrowser() {
  const made: ReturnType<typeof fakeContext>[] = [];
  const browser = {
    newContext: vi.fn(async () => {
      const c = fakeContext();
      made.push(c);
      return c.context;
    }),
  };
  return { browser: browser as unknown as Browser, made };
}

describe("the Google Analytics block in E2E", () => {
  it.each([
    "https://www.googletagmanager.com/gtag/js?id=G-MEWLGXSWXC",
    "https://googletagmanager.com/",
    "https://region1.google-analytics.com/g/collect?v=2&tid=G-MEWLGXSWXC",
    "https://www.google-analytics.com/g/collect",
    "http://google-analytics.com",
    "https://WWW.GoogleTagManager.com:443/gtm.js",
  ])("matches %s", (url) => {
    expect(BLOCKED_ANALYTICS_URL.test(url)).toBe(true);
  });

  it.each([
    "http://localhost:8080/",
    "https://abc.supabase.co/rest/v1/profiles",
    "https://googletagmanager.com.example.org/",
    "https://notgoogletagmanager.com/",
    "https://example.com/?next=https://www.google-analytics.com/",
    "https://user@example.com/google-analytics.com/",
  ])("does not match %s", (url) => {
    expect(BLOCKED_ANALYTICS_URL.test(url)).toBe(false);
  });

  it("covers every blocked host", () => {
    for (const host of BLOCKED_ANALYTICS_HOSTS)
      expect(BLOCKED_ANALYTICS_URL.test(`https://${host}/`)).toBe(true);
  });

  it("blockAnalytics aborts matching requests in the context", async () => {
    const { context, routes } = fakeContext();
    await blockAnalytics(context);
    expect(routes).toHaveLength(1);
    expect(routes[0].pattern).toBe(BLOCKED_ANALYTICS_URL);
    const route = { abort: vi.fn(async () => {}) };
    await routes[0].handler(route as unknown as Route);
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
  });

  it("installAnalyticsBlock blocks every context the browser creates, once", async () => {
    const { browser, made } = fakeBrowser();
    expect(installAnalyticsBlock(browser)).toBe(browser);
    installAnalyticsBlock(browser); // idempotent: no second wrapper
    await browser.newContext();
    await browser.newContext({ viewport: { width: 390, height: 844 } });
    expect(made).toHaveLength(2);
    for (const { routes } of made) {
      expect(routes).toHaveLength(1);
      expect(routes[0].pattern).toBe(BLOCKED_ANALYTICS_URL);
    }
  });

  it("the shared test overrides the browser fixture", () => {
    expect(typeof sharedTest).toBe("function");
    expect(typeof sharedTest.extend).toBe("function");
    const src = readFileSync("e2e/helpers/test.ts", "utf8");
    expect(src).toMatch(
      /browser:\s*\[\s*async \(\{ browser \}, use\) => \{\s*await use\(installAnalyticsBlock\(browser\)\);/,
    );
    expect(src).toContain('{ scope: "worker" }');
  });

  it("every spec imports the shared test, never @playwright/test directly", () => {
    const specs = readdirSync("e2e").filter((f) => f.endsWith(".spec.ts"));
    expect(specs.length).toBeGreaterThan(0);
    for (const file of specs) {
      const src = readFileSync(join("e2e", file), "utf8");
      expect(src, file).not.toMatch(/from\s+["']@playwright\/test["']/);
      expect(src, file).not.toMatch(/require\(\s*["']@playwright\/test["']\s*\)/);
      expect(src, file).toMatch(/from\s+["']\.\/helpers\/test["']/);
    }
  });

  it("no spec lets a catch-all route skip the block with continue()", () => {
    for (const file of readdirSync("e2e").filter((f) => f.endsWith(".spec.ts"))) {
      const src = readFileSync(join("e2e", file), "utf8");
      for (const m of src.matchAll(/\.route\(\s*(["'])\*\*(?:\/\*)?\1,/g)) {
        const body = src.slice(m.index, src.indexOf("\n  });", m.index));
        expect(body, file).not.toContain("route.continue(");
      }
    }
  });
});
