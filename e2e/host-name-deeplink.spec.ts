import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: after a hard refresh / fresh deep-link open of a game detail page,
 * the host name must still render `user_metadata.display_name` and never
 * collapse to the email local-part — even when the `profiles` read is slow.
 *
 * This is the "cold open" companion to host-name-throttled.spec.ts: the
 * other spec covers the create-time snapshot path; this one covers the
 * read path on a freshly mounted route with no warm cache.
 */

const PROFILES_REST = /\/rest\/v1\/profiles\b/;
const GAMES_REST = /\/rest\/v1\/games\b/;
const THROTTLE_MS = 2500;

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

function sessionDisplayName(): string {
  const session = JSON.parse(SESSION_JSON!);
  const meta = session?.user?.user_metadata ?? {};
  const name: string | undefined = meta.display_name || meta.full_name || meta.name;
  expect(name, "test account must have user_metadata.display_name").toBeTruthy();
  return name!;
}

function emailLocalPart(): string | null {
  try {
    const session = JSON.parse(SESSION_JSON!);
    const email: string | undefined = session?.user?.email;
    return email ? email.split("@")[0] : null;
  } catch {
    return null;
  }
}

async function createGameAndCaptureUrl(page: Page, title: string): Promise<string> {
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: /host a game/i })).toBeVisible();
  await page
    .getByPlaceholder(/title|game/i)
    .first()
    .fill(title)
    .catch(() => {});
  const addressInput = page.getByPlaceholder(/address|location|venue/i).first();
  if (await addressInput.isVisible().catch(() => false)) {
    const current = await addressInput.inputValue();
    if (!current) await addressInput.fill("123 Test Court, Demo City");
  }
  await page
    .getByRole("button", { name: /publish|host|create/i })
    .first()
    .click();
  await page.waitForURL(/\/games\/[^/?#]+/, { timeout: 15_000 });
  return page.url();
}

test("deep-link / hard-refresh of game detail keeps display_name (no email prefix)", async ({
  browser,
}) => {
  const displayName = sessionDisplayName();
  const emailPrefix = emailLocalPart();

  // --- Phase 1: warm context, create a game so we have a stable deep link.
  const warmCtx = await browser.newContext();
  const warmPage = await warmCtx.newPage();
  await restoreSession(warmPage);
  const title = `E2E deeplink host ${Date.now()}`;
  const deepLink = await createGameAndCaptureUrl(warmPage, title);
  await warmCtx.close();

  // --- Phase 2: brand-new context (no warm caches), open the deep link
  //     directly with throttled profile + games reads, simulating a hard
  //     refresh / share-link open on a slow connection.
  const coldCtx = await browser.newContext();
  const coldPage = await coldCtx.newPage();
  await restoreSession(coldPage);
  await coldPage.route(PROFILES_REST, async (route) => {
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    await route.continue();
  });
  await coldPage.route(GAMES_REST, async (route) => {
    await new Promise((r) => setTimeout(r, THROTTLE_MS / 2));
    await route.continue();
  });

  await coldPage.goto(deepLink, { waitUntil: "domcontentloaded" });
  // Display name must render and the email prefix must never appear as host.
  await expect(coldPage.getByText(displayName, { exact: false })).toBeVisible({ timeout: 20_000 });
  if (emailPrefix && emailPrefix !== displayName) {
    await expect(coldPage.getByText(new RegExp(`^${emailPrefix}$`))).toHaveCount(0);
  }

  // Hard reload — guarantees no in-memory React state survives.
  await coldPage.reload({ waitUntil: "domcontentloaded" });
  await expect(coldPage.getByText(displayName, { exact: false })).toBeVisible({ timeout: 20_000 });
  if (emailPrefix && emailPrefix !== displayName) {
    await expect(coldPage.getByText(new RegExp(`^${emailPrefix}$`))).toHaveCount(0);
  }

  await coldCtx.close();
});
