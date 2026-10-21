import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: hard-refreshing any protected route on desktop must keep the user
 * on the SAME URL and never bounce them to `/auth` or the marketing
 * landing `/`.
 *
 * Companion to `mobile-refresh-protected.spec.ts`. Covers the desktop
 * hydration path (default Playwright Chromium context) across every
 * top-level protected surface a user might refresh.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

// Routes that render themselves (no app-level redirect). Keep in sync
// with the mobile spec and with new protected top-level pages.
const PROTECTED_ROUTES = [
  "/feed",
  "/players",
  "/teams",
  "/create",
  "/profile",
  "/notifications",
  "/messages",
  "/settings",
] as const;

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

for (const route of PROTECTED_ROUTES) {
  test(`refresh on ${route} stays on ${route} (desktop)`, async ({ page }) => {
    test.skip(
      !SESSION_JSON || !STORAGE_KEY,
      "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
    );
    // Slow the token endpoint slightly so any hydration race surfaces
    // instead of finishing before AuthGate's first tick.
    await page.route(/\/auth\/v1\/(token|user)\b/, async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.continue();
    });

    const forcedRedirects: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "warning") return;
      const text = msg.text();
      if (text.includes("[AuthGate] redirecting to /auth")) {
        forcedRedirects.push(text);
      }
    });

    await restoreSession(page);

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

    // And explicitly assert we didn't get bounced to the landing page or /auth.
    const finalPath = new URL(page.url()).pathname;
    expect(finalPath, "must not redirect to landing").not.toBe("/");
    expect(finalPath, "must not redirect to /auth").not.toBe("/auth");

    expect(
      forcedRedirects,
      `AuthGate must not force a redirect to /auth on refresh: ${JSON.stringify(forcedRedirects)}`,
    ).toHaveLength(0);
  });
}

test("signed-out refresh on a protected route still redirects to /auth", async ({ page }) => {
  test.skip(!STORAGE_KEY, "Requires the managed auth storage key.");
  // Sanity check: the guard should still send unauthenticated users to
  // /auth?next=/feed. This ensures the "stay on page" fix didn't over-correct.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((key) => window.localStorage.removeItem(key!), STORAGE_KEY!);

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/auth(\?|$)/, { timeout: 15_000 });

  const url = new URL(page.url());
  expect(url.pathname).toBe("/auth");
  expect(url.searchParams.get("next")).toMatch(/^\/feed(?:\?|$)/);
});

test("unusable persisted session exits the loader and redirects to sign-in", async ({ page }) => {
  test.skip(!STORAGE_KEY, "Requires the managed auth storage key.");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
  }, STORAGE_KEY!);

  await page.route(/\/auth\/v1\/(token|user)\b/, async (route) => {
    await route.abort("failed");
  });

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/auth(\?|$)/, { timeout: 15_000 });

  const url = new URL(page.url());
  expect(url.pathname).toBe("/auth");
  expect(url.searchParams.get("next")).toMatch(/^\/feed(?:\?|$)/);
});
