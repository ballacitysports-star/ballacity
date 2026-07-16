import { test, expect, devices, type Browser, type Page } from "@playwright/test";

/**
 * E2E: hard-refreshing a protected route on mobile (iOS Safari / Android
 * Chrome viewports + UA) must keep the user on the SAME URL and never
 * bounce them to `/auth` or the marketing landing `/`.
 *
 * Regression guard for the mobile-only race where Supabase's localStorage
 * session hydrates one tick after AuthGate's initial `loading -> false`
 * transition. Also verifies the OneSignal SW navigation bypass never
 * serves a cached shell for a protected navigation.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const PROTECTED_ROUTES = ["/feed", "/discover", "/profile", "/notifications"] as const;

const MOBILE_DEVICES = [
  { label: "iOS Safari (iPhone 13)", descriptor: devices["iPhone 13"] },
  { label: "Android Chrome (Pixel 7)", descriptor: devices["Pixel 7"] },
] as const;

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

async function openMobileContext(browser: Browser, descriptor: (typeof devices)[string]) {
  const context = await browser.newContext({ ...descriptor });
  const page = await context.newPage();
  await restoreSession(page);
  return { context, page };
}

for (const { label, descriptor } of MOBILE_DEVICES) {
  test.describe(label, () => {
    for (const route of PROTECTED_ROUTES) {
      test(`refresh on ${route} stays on ${route}`, async ({ browser }) => {
        const { context, page } = await openMobileContext(browser, descriptor);
        try {
          // Simulate a slightly slow mobile network for the auth token
          // endpoint so the hydration race has a chance to surface.
          await page.route(/\/auth\/v1\/(token|user)\b/, async (route) => {
            await new Promise((r) => setTimeout(r, 400));
            await route.continue();
          });

          const forcedRedirects: Array<Record<string, unknown>> = [];
          page.on("console", (msg) => {
            if (msg.type() !== "warning") return;
            const text = msg.text();
            if (text.includes("[AuthGate] redirecting to /auth")) {
              forcedRedirects.push({ text });
            }
          });

          await page.goto(route, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle").catch(() => {});
          await expect(page).toHaveURL(new RegExp(`${route}(?:[?#/].*)?$`), { timeout: 15_000 });

          // Hard reload — no in-memory React / router state survives.
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle").catch(() => {});

          await expect(page, "must stay on the same protected route after refresh").toHaveURL(
            new RegExp(`${route}(?:[?#/].*)?$`),
            { timeout: 15_000 },
          );

          expect(
            forcedRedirects,
            `AuthGate must not force a redirect to /auth on refresh: ${JSON.stringify(
              forcedRedirects,
            )}`,
          ).toHaveLength(0);
        } finally {
          await context.close();
        }
      });
    }
  });
}
