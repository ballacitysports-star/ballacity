import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: invite deep-links with a malformed `exp` param (non-numeric, negative,
 * zero, NaN) must be treated as expired invites — showing the "Invite
 * expired" banner and steering the viewer to the /discover fallback via the
 * banner CTA. No join / payment writes should fire.
 *
 * A completely missing `exp` remains a valid non-expiring invite and is
 * covered by other specs; this suite only exercises the malformed cases.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g1";
const FAKE_HOST_ID = "11111111-2222-3333-4444-555555555555";

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

const MALFORMED_CASES: Array<{ label: string; expParam: string }> = [
  { label: "non-numeric string", expParam: "not-a-number" },
  { label: "negative timestamp", expParam: "-1" },
  { label: "zero", expParam: "0" },
  { label: "NaN literal", expParam: "NaN" },
];

for (const { label, expParam } of MALFORMED_CASES) {
  test(`malformed exp (${label}) → Invite expired banner, CTA routes to /discover`, async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await restoreSession(page);

    // Any write to join_requests / payment_submissions is a bug in this flow.
    const writeAttempts: string[] = [];
    await page.route("**/rest/v1/join_requests**", (route) => {
      if (route.request().method() !== "GET") writeAttempts.push("join_requests");
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/rest/v1/payment_submissions**", (route) => {
      if (route.request().method() !== "GET") writeAttempts.push("payment_submissions");
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto(
      `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}&exp=${encodeURIComponent(expParam)}`,
      { waitUntil: "domcontentloaded" },
    );

    // Land on the game detail route — malformed exp does not throw.
    await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}`, { timeout: 10_000 });

    // Expired banner renders instead of the normal "You're invited" one.
    const expired = page.getByTestId("invite-expired-banner");
    await expect(expired).toBeVisible({ timeout: 10_000 });
    await expect(expired).toContainText(/invite expired/i);

    const normalBanner = page.getByRole("status").filter({ hasText: /you're invited to this game/i });
    await expect(normalBanner).toHaveCount(0);

    // Banner CTA links to the discovery fallback.
    const cta = expired.getByRole("link", { name: /browse open games/i });
    await expect(cta).toHaveAttribute("href", "/discover");

    // Following the CTA lands on /discover.
    await cta.click();
    await page.waitForURL((u) => u.pathname === "/discover", { timeout: 10_000 });

    expect(writeAttempts, "malformed-exp invite must not trigger join/payment writes").toEqual([]);

    await ctx.close();
  });
}
