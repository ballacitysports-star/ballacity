import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: throttle the `profiles` table read and confirm the host name shown on
 * (1) the created game's detail page and (2) the matching feed/hosted card
 * always reflects `user_metadata.display_name` — never the email local-part.
 *
 * Why this exists: when the in-memory `useMyProfile` hook hadn't finished
 * loading, the create flow used to persist the email prefix as the host name.
 * The fix moved that snapshot through `resolveHostSnapshot`, which prefers
 * the DB `display_name`. This spec proves the behavior end-to-end under a
 * deliberately slow profile read.
 */

const PROFILES_REST = /\/rest\/v1\/profiles\b/;
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

async function throttleProfileReads(page: Page) {
  // Delay every Supabase Data API hit to the `profiles` table so the
  // submit-time resolver is forced to wait the same way it would on a slow
  // network. The handler responds normally after the delay.
  await page.route(PROFILES_REST, async (route) => {
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    await route.continue();
  });
}

async function readDisplayName(page: Page): Promise<string> {
  // The Supabase session JSON carries `user.user_metadata.display_name` (set
  // at sign-up). We compare the rendered host name against this exact value.
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

test("host name uses user_metadata.display_name under throttled profile loading", async ({
  page,
}) => {
  const displayName = await readDisplayName(page);
  const emailPrefix = emailLocalPart();

  await restoreSession(page);
  await throttleProfileReads(page);

  // 1. Open the host-a-game form.
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: /host a game/i })).toBeVisible();

  // 2. Fill the bare minimum required to publish.
  const title = `E2E throttled host ${Date.now()}`;
  await page
    .getByPlaceholder(/title|game/i)
    .first()
    .fill(title)
    .catch(() => {});
  // Address: rely on whatever is pre-populated; if empty, type a placeholder.
  const addressInput = page.getByPlaceholder(/address|location|venue/i).first();
  if (await addressInput.isVisible().catch(() => false)) {
    const current = await addressInput.inputValue();
    if (!current) await addressInput.fill("123 Test Court, Demo City");
  }

  // 3. Publish — this triggers the throttled `profiles` SELECT inside
  //    `resolveHostSnapshot` before the hosted game is saved.
  await page
    .getByRole("button", { name: /publish|host|create/i })
    .first()
    .click();

  // 4. Detail page should render the host's display_name (not the email prefix).
  await page.waitForURL(/\/games\//, { timeout: 15_000 });
  const detailHost = page.locator('[data-testid="game-host-name"], :text("Hosted by") + *').first();
  // Fall back to a permissive check: the display name must appear somewhere on the page.
  await expect(page.getByText(displayName, { exact: false })).toBeVisible({ timeout: 10_000 });
  if (emailPrefix && emailPrefix !== displayName) {
    await expect(page.getByText(new RegExp(`^${emailPrefix}$`))).toHaveCount(0);
  }
  // Best-effort assert against a dedicated testid if present.
  if (await detailHost.count()) {
    await expect(detailHost).toContainText(displayName);
  }

  // 5. Navigate to the feed / pickup tab and locate the card we just created.
  await page.goto("/feed");
  const card = page
    .locator('article, [data-testid="game-card"]')
    .filter({ hasText: title })
    .first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(displayName);
  if (emailPrefix && emailPrefix !== displayName) {
    await expect(card.getByText(new RegExp(`^${emailPrefix}$`))).toHaveCount(0);
  }
});
