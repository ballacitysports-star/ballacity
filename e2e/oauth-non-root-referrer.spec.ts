import { test, expect, type Page } from "@playwright/test";
import { stubNewUserOnboarding } from "./helpers/server-fn";

/**
 * OAuth returns where `document.referrer` is NOT `/` (e.g. user tapped a
 * "Sign in" CTA from a deep link like `/players` or `/trainers`).
 *
 * - Brand-new user (profile.account_type === null) MUST still land on
 *   `/onboarding/account-type` with pending state preserved.
 * - Returning user (profile.account_type is set) MUST land on the saved
 *   `openrun:oauth-next` path (or `/feed` fallback), and pending state
 *   MUST be cleared after consumption.
 *
 * See `src/routes/__root.tsx` (OAuth reconcile) and `src/routes/auth.tsx`.
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
const NEXT_PATH = "/players?src=non-root-referrer-e2e";
const REFERRER_PATH = "/players";

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

async function primeAndLandOnAuth(page: Page) {
  // Land on a non-root deep link first so `/auth` inherits it as referrer.
  await page.goto(REFERRER_PATH, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([sbKey, sbValue, pendingKey, nextKey, nextPath]) => {
      window.localStorage.setItem(sbKey!, sbValue!);
      window.sessionStorage.setItem(pendingKey!, "player");
      window.sessionStorage.setItem(nextKey!, nextPath!);
    },
    [STORAGE_KEY!, SESSION_JSON!, PENDING_KEY, NEXT_KEY, NEXT_PATH] as const,
  );

  await page.evaluate((next) => {
    window.location.assign("/auth?next=" + encodeURIComponent(next));
  }, NEXT_PATH);
  await page.waitForURL(/\/auth(?:[?#/].*)?$/, { timeout: 15_000 });

  // Path only: /players writes its default filters into the query string
  // (`/players?q=&sport=…`) before the click-through, and that is the referrer.
  const referrer = await page.evaluate(() => document.referrer);
  expect(referrer.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0]).toBe(REFERRER_PATH);
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

test.describe("OAuth from /auth with non-root referrer", () => {
  for (const provider of PROVIDERS) {
    test(`${provider}: NEW user → /onboarding/account-type with pending state preserved`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubAccountType(page, null);
        await stubNewUserOnboarding(page, provider);
        await primeAndLandOnAuth(page);
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

    test(`${provider}: RETURNING user → saved next path (not landing page)`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubAccountType(page, "player");
        await primeAndLandOnAuth(page);
        await emitOAuthSignedIn(page, provider);

        // Must NOT bounce to `/` and must NOT go to onboarding.
        await expect(page).toHaveURL(
          new RegExp(
            "/players(?:[?#/].*)?$".replace(/\//g, "\\/"),
          ),
          { timeout: 15_000 },
        );
        await expect(page).not.toHaveURL(/\/onboarding\/account-type/);
        await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/?$/);
      } finally {
        await context.close();
      }
    });
  }
});
