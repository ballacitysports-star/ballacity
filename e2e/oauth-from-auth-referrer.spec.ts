import { test, expect, type Page } from "@playwright/test";
import { stubNewUserOnboarding } from "./helpers/server-fn";

/**
 * A brand-new user tapping "Continue with Google/Apple" on `/auth` — arriving
 * there from the marketing landing page (`document.referrer === "/"`) — must
 * land on `/onboarding/account-type` after the OAuth callback, with the
 * pending onboarding state (chosen account type + optional next path) still
 * intact in sessionStorage so the picker can honor it once the user confirms.
 *
 * See `src/routes/__root.tsx` (OAuth new-user reconcile branch) and
 * `src/routes/auth.tsx` (pending stash + `openrun:oauth-next`).
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
const NEXT_PATH = "/feed?src=auth-referrer-e2e";

async function stubNullAccountType(page: Page) {
  await page.route(/\/rest\/v1\/profiles\?[^ ]*select=account_type/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ account_type: null }]),
    });
  });

  // Regression guard: an OAuth new-user path must NEVER write an account_type
  // into the profile from the client-side pending stash. The picker screen is
  // the source of truth.
  await page.route(/\/rest\/v1\/profiles\?[^ ]*id=eq\./, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "unexpected profile PATCH on OAuth new-user" }),
      });
      return;
    }
    await route.continue();
  });
}

async function primeStorageAndLandOnAuth(page: Page) {
  // Visit the landing page first so `/auth` inherits it as `document.referrer`.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([sbKey, sbValue, pendingKey, nextKey, nextPath]) => {
      window.localStorage.setItem(sbKey!, sbValue!);
      // Simulate the user picking "player" in the signup form on /auth and
      // requesting a post-auth destination — both should survive the OAuth
      // callback and be consumed by the onboarding picker, not root reconcile.
      window.sessionStorage.setItem(pendingKey!, "player");
      window.sessionStorage.setItem(nextKey!, nextPath!);
    },
    [STORAGE_KEY!, SESSION_JSON!, PENDING_KEY, NEXT_KEY, NEXT_PATH] as const,
  );

  // Navigate to /auth via the same tab so document.referrer resolves to "/".
  await page.evaluate(() => {
    window.location.assign("/auth?next=" + encodeURIComponent("/feed?src=auth-referrer-e2e"));
  });
  await page.waitForURL(/\/auth(?:[?#/].*)?$/, { timeout: 15_000 });

  const referrer = await page.evaluate(() => document.referrer);
  expect(referrer.replace(/^https?:\/\/[^/]+/, "")).toBe("/");
}

test.describe("OAuth from /auth with referrer '/' → onboarding picker", () => {
  for (const provider of PROVIDERS) {
    test(`${provider}: new user lands on /onboarding/account-type with pending state preserved`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubNullAccountType(page);
        await stubNewUserOnboarding(page, provider);
        await primeStorageAndLandOnAuth(page);

        // Simulate the provider callback resolving on this tab and emitting
        // a SIGNED_IN with app_metadata.provider set. This exercises the
        // exact reconcile branch in src/routes/__root.tsx that must redirect
        // OAuth new-users to the picker instead of auto-applying `pending`.
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
          if (typeof emit !== "function") {
            throw new Error("Supabase auth emit hook missing");
          }
          await emit.call(supabase.auth, "SIGNED_IN", patched, false);
        }, provider);

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 15_000,
        });

        // Pending choice and saved next path MUST survive — onboarding
        // consumes them after the user confirms a type on the picker.
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
  }
});
