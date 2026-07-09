import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Google OAuth sign-in redirect completion.
 *
 * We cannot automate the real Google consent popup from headless
 * Chromium — provider policy blocks it. Instead we assert the two halves
 * of the flow that live in OUR code:
 *
 *   1. `/auth` renders the Google button and clicking it invokes the
 *      Lovable OAuth helper without throwing a login-failed toast.
 *   2. `/oauth/callback` — the route the provider redirects back to —
 *      detects the resulting Supabase session and forwards the user into
 *      the app (either `/onboarding` for new users or `/profile` / home
 *      for returning users), never leaving them on a "sign-in failed" state.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

async function seedSession(page: Page, postAuthRedirect: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value, redirect]) => {
      window.localStorage.setItem(key!, value!);
      window.sessionStorage.setItem("openrun:postAuthRedirect", redirect!);
    },
    [STORAGE_KEY!, SESSION_JSON!, postAuthRedirect],
  );
}

async function clearSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((key) => {
    window.localStorage.removeItem(key!);
    window.sessionStorage.clear();
  }, STORAGE_KEY!);
}

test("google sign-in: /oauth/callback consumes the session and redirects into the app", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const failureText =
    /(sign[- ]?in failed|couldn't finish|login failed|auth failed)/i;
  page.on("pageerror", (err) => {
    throw new Error(`Unexpected page error during google callback: ${err.message}`);
  });

  await seedSession(page, "/profile");

  await page.goto("/oauth/callback", { waitUntil: "domcontentloaded" });

  await page.waitForURL(
    (url) => {
      const p = url.pathname;
      return (
        p !== "/oauth/callback" &&
        (p === "/onboarding" || p === "/profile" || p === "/" || p.startsWith("/profile"))
      );
    },
    { timeout: 15_000 },
  );

  const landedPath = new URL(page.url()).pathname;
  expect(
    ["/onboarding", "/profile", "/"].some((p) => landedPath === p || landedPath.startsWith(p)),
    `expected /onboarding or home/profile, got ${landedPath}`,
  ).toBe(true);

  await expect(page.getByText(failureText)).toHaveCount(0);

  const hasSession = await page.evaluate(
    (key) => Boolean(window.localStorage.getItem(key!)),
    STORAGE_KEY!,
  );
  expect(hasSession, "supabase session missing after OAuth callback").toBe(true);

  await ctx.close();
});

test("/auth renders the Google button and invoking it does not show a login-failed state", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await clearSession(page);

  await page.goto("/auth", { waitUntil: "domcontentloaded" });

  const googleBtn = page.getByRole("button", { name: /continue with google/i });
  await expect(googleBtn).toBeVisible();

  await page.route(/(accounts\.google\.com|oauth\.lovable\.app|\/~oauth\/)/, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );

  await googleBtn.click();
  await expect(
    page.getByText(/(sign[- ]?in failed|auth failed)/i),
  ).toHaveCount(0);

  await ctx.close();
});
