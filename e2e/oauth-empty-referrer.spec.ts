import { test, expect, type Page } from "@playwright/test";

/**
 * OAuth returns where `document.referrer` is empty (direct navigation to
 * `/auth` — e.g. bookmark, pasted URL, external link with `rel=noreferrer`,
 * or a fresh tab). Regression guard for the referrer-based bounce logic in
 * `src/routes/__root.tsx` and `src/routes/auth.tsx`.
 *
 * - Brand-new user (profile.account_type === null) → `/onboarding/account-type`
 *   with pending state preserved.
 * - Returning user (profile.account_type set)      → saved `openrun:oauth-next`
 *   (or `/feed` fallback when no next was stashed).
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const PROVIDERS = ["google", "apple"] as const;
const PENDING_KEY = "openrun.pending_account_type";
const NEXT_KEY = "openrun:oauth-next";
const NEXT_PATH = "/trainers?src=empty-referrer-e2e";

async function primeAuthWithEmptyReferrer(page: Page, options: { stashNext: boolean }) {
  // Seed storage on the app origin without leaving a referrer chain: use
  // `about:blank` first so the subsequent /auth load has referrer === "".
  await page.goto("about:blank");
  // Establish origin via a lightweight fetch-free approach: navigate to /auth
  // once to install storage, then blank again, then re-enter /auth so referrer
  // is empty on the tested load.
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([sbKey, sbValue, pendingKey, nextKey, nextPath, doStash]) => {
      window.localStorage.setItem(sbKey as string, sbValue as string);
      window.sessionStorage.setItem(pendingKey as string, "player");
      if (doStash) {
        window.sessionStorage.setItem(nextKey as string, nextPath as string);
      } else {
        window.sessionStorage.removeItem(nextKey as string);
      }
    },
    [STORAGE_KEY!, SESSION_JSON!, PENDING_KEY, NEXT_KEY, NEXT_PATH, options.stashNext] as const,
  );

  await page.goto("about:blank");
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/auth(?:[?#/].*)?$/, { timeout: 15_000 });
  const referrer = await page.evaluate(() => document.referrer);
  expect(referrer).toBe("");
}

function stubAccountType(page: Page, accountType: string | null) {
  return page.route(/\/rest\/v1\/profiles\?[^ ]*select=account_type/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ account_type: accountType }]),
    });
  });
}

async function emitOAuthSignedIn(page: Page, provider: string) {
  await page.evaluate(async (providerId) => {
    const mod = await import("/src/integrations/supabase/client.ts");
    const supabase = (mod as { supabase: import("@supabase/supabase-js").SupabaseClient })
      .supabase;
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) throw new Error("no session in test context");
    const patched = {
      ...session,
      user: {
        ...session.user,
        app_metadata: { ...(session.user.app_metadata ?? {}), provider: providerId },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authAny = supabase.auth as any;
    authAny.getSession = async () => ({ data: { session: patched }, error: null });
    const emit = authAny._notifyAllSubscribers ?? authAny.notifyAllSubscribers;
    if (typeof emit !== "function") throw new Error("Supabase auth emit hook missing");
    await emit.call(supabase.auth, "SIGNED_IN", patched, false);
  }, provider);
}

test.describe("OAuth on /auth with empty document.referrer", () => {
  for (const provider of PROVIDERS) {
    test(`${provider}: NEW user → /onboarding/account-type with pending state preserved`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubAccountType(page, null);
        await primeAuthWithEmptyReferrer(page, { stashNext: true });
        await emitOAuthSignedIn(page, provider);

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 15_000,
        });

        const state = await page.evaluate(
          ([pendingKey, nextKey]) => ({
            pending: window.sessionStorage.getItem(pendingKey!),
            next: window.sessionStorage.getItem(nextKey!),
          }),
          [PENDING_KEY, NEXT_KEY] as const,
        );
        expect(state.pending).toBe("player");
        expect(state.next).toBe(NEXT_PATH);
      } finally {
        await context.close();
      }
    });

    test(`${provider}: RETURNING user with stashed next → next path (not "/")`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubAccountType(page, "player");
        await primeAuthWithEmptyReferrer(page, { stashNext: true });
        await emitOAuthSignedIn(page, provider);

        await expect(page).toHaveURL(/\/trainers(?:[?#/].*)?$/, { timeout: 15_000 });
        await expect(page).not.toHaveURL(/\/onboarding\/account-type/);
        await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/?$/);
      } finally {
        await context.close();
      }
    });

    test(`${provider}: RETURNING user without next → /feed fallback`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubAccountType(page, "player");
        await primeAuthWithEmptyReferrer(page, { stashNext: false });
        await emitOAuthSignedIn(page, provider);

        await expect(page).toHaveURL(/\/feed(?:[?#/].*)?$/, { timeout: 15_000 });
        await expect(page).not.toHaveURL(/\/onboarding\/account-type/);
      } finally {
        await context.close();
      }
    });
  }
});
