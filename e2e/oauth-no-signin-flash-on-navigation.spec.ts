import { test, expect, type Page } from "@playwright/test";

/**
 * E2E regression: after an OAuth (social) login, client-side route changes
 * must never re-show the full-screen auth loader — neither "Signing you in…"
 * nor "Loading your account…".
 *
 * The old bug: the onboarding-status guard in `__root.tsx` reset to an
 * "unknown" state on every pathname change, remounting AuthLoadingFallback
 * for a frame. A MutationObserver installed before navigation catches even a
 * single-frame flash that `expect(...).not.toBeVisible()` would miss.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

// Must match `__root.tsx`.
const OAUTH_PROVIDER_KEY = "openrun:oauth-provider";
const LOADER_TEXTS = ["Signing you in", "Loading your account"];

// Bottom-nav tabs, addressed by their aria-labels, in click order.
const TAB_HOPS = ["Available Players", "Activity", "Profile", "Home", "Available Players"] as const;

declare global {
  interface Window {
    __authLoaderFlashes?: string[];
  }
}

/** Restore the session and mark an OAuth attempt as the sign-in path taken. */
async function restoreOAuthSession(page: Page, provider: "google" | "apple") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value, oauthKey, prov]) => {
      window.localStorage.setItem(key!, value!);
      window.sessionStorage.setItem(oauthKey!, prov!);
    },
    [STORAGE_KEY!, SESSION_JSON!, OAUTH_PROVIDER_KEY, provider] as const,
  );
}

/**
 * Watch the whole document for the loader copy appearing. Records every
 * sighting so a sub-frame flash cannot be missed by polling assertions.
 */
async function installLoaderFlashObserver(page: Page) {
  await page.evaluate((texts) => {
    window.__authLoaderFlashes = [];
    const scan = (root: ParentNode) => {
      const text = (root as HTMLElement).innerText ?? "";
      for (const needle of texts) {
        if (text.includes(needle)) {
          window.__authLoaderFlashes!.push(`${needle} @ ${location.pathname}`);
        }
      }
    };
    scan(document.body);
    new MutationObserver(() => scan(document.body)).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, LOADER_TEXTS);
}

async function readFlashes(page: Page) {
  return page.evaluate(() => window.__authLoaderFlashes ?? []);
}

for (const provider of ["google", "apple"] as const) {
  test(`no auth loader flash while navigating after ${provider} login`, async ({ page }) => {
    await restoreOAuthSession(page, provider);

    // Land on the signed-in home first; the initial loader here is expected.
    await page.goto("/feed", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Home")).toBeVisible({ timeout: 20_000 });
    for (const needle of LOADER_TEXTS) {
      await expect(page.getByText(needle)).toHaveCount(0, { timeout: 20_000 });
    }

    // Only now start watching — everything after this is a route change.
    await installLoaderFlashObserver(page);

    for (const label of TAB_HOPS) {
      await page.getByLabel(label, { exact: true }).first().click();
      await page.waitForTimeout(400);

      const flashes = await readFlashes(page);
      expect(
        flashes,
        `auth loader flashed during navigation to "${label}": ${JSON.stringify(flashes)}`,
      ).toEqual([]);
    }

    // Sanity: the nav is still mounted, i.e. the app never fell back to the
    // full-screen loader shell at any point during the hops.
    await expect(page.getByLabel("Home", { exact: true }).first()).toBeVisible();
  });
}

test("deep-linking between protected routes after OAuth keeps the app mounted", async ({
  page,
}) => {
  await restoreOAuthSession(page, "google");

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Home")).toBeVisible({ timeout: 20_000 });

  await installLoaderFlashObserver(page);

  // Router-driven navigation (no full page load) across non-tab routes.
  for (const path of ["/settings", "/profile", "/players", "/feed"]) {
    await page.evaluate((to) => window.history.pushState({}, "", to!), path);
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(new RegExp(`${path}(?:[?#].*)?$`));

    const flashes = await readFlashes(page);
    expect(flashes, `auth loader flashed on ${path}: ${JSON.stringify(flashes)}`).toEqual([]);
  }
});
