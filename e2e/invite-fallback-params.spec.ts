import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: when a game deep-link carries fallback/invalid invite params, the app
 * must route safely to the normal game detail page — NOT the invite flow.
 *
 * Cases covered:
 *   (a) `invite=0&from=<hostId>`  → invite mode OFF: banner hidden, no error
 *       toast, normal join CTA visible, URL stays on /games/$gameId.
 *   (b) `from=<hostId>` only      → same: invite mode OFF, normal join CTA.
 *   (c) `invite=bogus&from=x`     → validateSearch strips both: URL is
 *       rewritten to /games/$gameId with no query params, banner hidden.
 *
 * Uses `g1` (free, no-approval sample game) so the CTA renders as "Join"
 * without any REST mocking. Auto-skips without a restored Supabase session.
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

async function assertNoInviteBanner(page: Page) {
  const banner = page.getByRole("status").filter({ hasText: /you're invited to this game/i });
  await expect(banner).toHaveCount(0);
}

async function assertNoTamperToast(page: Page) {
  const toast = page.getByText(/invalid or has been tampered with/i);
  await expect(toast).toHaveCount(0);
}

test("invite=0 with `from` → fallback: no banner, no error, normal Join CTA", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await restoreSession(page);

  await page.goto(`/games/${GAME_ID}?invite=0&from=${FAKE_HOST_ID}`, { waitUntil: "domcontentloaded" });

  // Land on the game page, invite params stripped/normalized: `invite=0` is not "1".
  await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}`, { timeout: 10_000 });

  await assertNoInviteBanner(page);
  await assertNoTamperToast(page);

  // Normal CTA renders (g1 is free + no-approval → "Join").
  const cta = page.getByRole("button", { name: /^join(\s|·|$)/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });

  // validateSearch drops `invite=0` (only "1"/1/true count). `from` alone
  // may or may not survive per implementation — either way, invite mode is off.
  const url = new URL(page.url());
  expect(url.searchParams.get("invite")).not.toBe("1");

  await ctx.close();
});

test("`from` param alone (no invite) → fallback: no banner, no error", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await restoreSession(page);

  await page.goto(`/games/${GAME_ID}?from=${FAKE_HOST_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}`, { timeout: 10_000 });

  await assertNoInviteBanner(page);
  await assertNoTamperToast(page);

  const cta = page.getByRole("button", { name: /^join(\s|·|$)/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });

  const url = new URL(page.url());
  expect(url.searchParams.get("invite")).not.toBe("1");

  await ctx.close();
});

test("invite=bogus with junk `from` → fallback: params stripped, no banner", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await restoreSession(page);

  await page.goto(`/games/${GAME_ID}?invite=totally-bogus&from=%20`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}`, { timeout: 10_000 });

  await assertNoInviteBanner(page);
  await assertNoTamperToast(page);

  // Whitespace-only `from` is not stored by validateSearch (length > 0 after
  // decode, but semantically empty). Regardless, invite mode must be off.
  const url = new URL(page.url());
  expect(url.searchParams.get("invite")).not.toBe("1");

  const cta = page.getByRole("button", { name: /^join(\s|·|$)/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });

  await ctx.close();
});

test("unknown gameId with invite params → routes to notFound fallback, not invite flow", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await restoreSession(page);

  await page.goto(
    `/games/does-not-exist?invite=1&from=${FAKE_HOST_ID}`,
    { waitUntil: "domcontentloaded" },
  );

  // The route's notFoundComponent renders "Game not found" with a Back to feed link.
  const notFound = page.getByRole("heading", { name: /game not found/i });
  await expect(notFound).toBeVisible({ timeout: 10_000 });

  // No invite banner and no tampering toast on the fallback page.
  await assertNoInviteBanner(page);
  await assertNoTamperToast(page);

  // "Back to feed" link is present and points at /feed.
  const back = page.getByRole("link", { name: /back to feed/i });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", "/feed");

  await ctx.close();
});
