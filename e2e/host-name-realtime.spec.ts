import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: while the game detail page and feed card are mounted, trigger a
 * realtime-driven refetch (by invalidating React Query caches the same way
 * a `postgres_changes` event would) with `profiles` reads throttled. The
 * host name must stay on `user_metadata.display_name` throughout — it must
 * never flicker to the email local-part mid-refresh.
 *
 * Companion to:
 *   - host-name-throttled.spec.ts  (create-time snapshot)
 *   - host-name-deeplink.spec.ts   (cold deep-link / hard refresh)
 */

const PROFILES_REST = /\/rest\/v1\/profiles\b/;
const THROTTLE_MS = 2500;
const SAMPLE_INTERVAL_MS = 150;
const SAMPLE_DURATION_MS = 4000;

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

async function throttleProfileReads(page: Page) {
  await page.route(PROFILES_REST, async (route) => {
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    await route.continue();
  });
}

/** Force a refetch the same way a realtime postgres_changes handler would. */
async function fireRealtimeStyleInvalidations(page: Page) {
  await page.evaluate(() => {
    // The app exposes the React Query client on window for debug; if it
    // isn't, fall back to dispatching a focus event which also triggers
    // refetchOnWindowFocus.
    const qc = (
      window as unknown as { queryClient?: { invalidateQueries: (opts?: unknown) => void } }
    ).queryClient;
    if (qc?.invalidateQueries) {
      qc.invalidateQueries();
    } else {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
}

async function sampleHostNameOverTime(page: Page, forbidden: string | null) {
  const start = Date.now();
  let seenForbidden = false;
  const samples: string[] = [];
  while (Date.now() - start < SAMPLE_DURATION_MS) {
    const text =
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || "";
    samples.push(text.slice(0, 200));
    if (forbidden && new RegExp(`(^|\\s|>)${forbidden}(\\s|<|$)`).test(text)) {
      seenForbidden = true;
      break;
    }
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }
  return { seenForbidden, samples };
}

test("realtime refresh under throttled profile reads keeps display_name (no email-prefix flicker)", async ({
  page,
}) => {
  const displayName = sessionDisplayName();
  const emailPrefix = emailLocalPart();

  await restoreSession(page);

  // 1. Create a game (with normal-speed profile reads so the snapshot is
  //    correctly persisted as display_name).
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: /host a game/i })).toBeVisible();
  const title = `E2E realtime host ${Date.now()}`;
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
  const gameUrl = page.url();

  // Sanity: the freshly rendered detail page shows display_name.
  await expect(page.getByText(displayName, { exact: false })).toBeVisible({ timeout: 10_000 });

  // 2. NOW slow down profile reads, then trigger realtime-style invalidations
  //    repeatedly. The persisted host snapshot must keep rendering — the
  //    in-flight `profiles` request must never overwrite it with an email
  //    prefix while the cache is empty/stale.
  await throttleProfileReads(page);
  for (let i = 0; i < 3; i++) {
    await fireRealtimeStyleInvalidations(page);
    await page.waitForTimeout(300);
  }

  const detail = await sampleHostNameOverTime(
    page,
    emailPrefix && emailPrefix !== displayName ? emailPrefix : null,
  );
  expect(detail.seenForbidden, "email prefix appeared on detail page during refresh").toBe(false);
  await expect(page.getByText(displayName, { exact: false })).toBeVisible();

  // 3. Repeat on the feed card.
  await page.goto("/feed");
  const card = page
    .locator('article, [data-testid="game-card"]')
    .filter({ hasText: title })
    .first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(displayName);

  for (let i = 0; i < 3; i++) {
    await fireRealtimeStyleInvalidations(page);
    await page.waitForTimeout(300);
  }
  const feed = await sampleHostNameOverTime(
    page,
    emailPrefix && emailPrefix !== displayName ? emailPrefix : null,
  );
  expect(feed.seenForbidden, "email prefix appeared on feed card during refresh").toBe(false);
  await expect(card).toContainText(displayName);

  // 4. Return to the deep link to confirm post-refresh state is still clean.
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(displayName, { exact: false })).toBeVisible({ timeout: 15_000 });
  if (emailPrefix && emailPrefix !== displayName) {
    await expect(page.getByText(new RegExp(`^${emailPrefix}$`))).toHaveCount(0);
  }
});
