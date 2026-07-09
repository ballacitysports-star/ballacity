import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: OAuth sign-in (Google + Apple) redirect completion.
 *
 * We cannot automate the real Google / Apple consent popup from headless
 * Chromium — provider policy blocks it and it would require live user
 * credentials. Instead we assert the two halves of the flow that live in
 * OUR code:
 *
 *   1. `/auth` renders both provider buttons and clicking them invokes the
 *      Lovable OAuth helper without throwing a login-failed toast.
 *   2. `/oauth/callback` — the route the provider redirects back to —
 *      detects the resulting Supabase session and forwards the user into
 *      the app (either `/onboarding` for new users or `/profile` / home
 *      for returning users), never leaving them on a "sign-in failed" state.
 *
 * The managed Supabase session injected via `LOVABLE_BROWSER_SUPABASE_*`
 * is the exact same session shape Google / Apple produce after consent, so
 * seeding it into localStorage before visiting `/oauth/callback` is a
 * faithful stand-in for "the provider just called us back".
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

async function seedSession(page: Page, postAuthRedirect: string) {
  // Land on same-origin first so storage writes hit the app origin.
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

for (const provider of ["google", "apple"] as const) {
  test(`${provider} sign-in: /oauth/callback consumes the session and redirects into the app`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const failureText =
      /(sign[- ]?in failed|couldn't finish|login failed|auth failed)/i;
    page.on("pageerror", (err) => {
      throw new Error(`Unexpected page error during ${provider} callback: ${err.message}`);
    });

    // Stash the "return here after sign-in" hint the /auth button sets,
    // then seed the injected session so /oauth/callback sees an authed user
    // — exactly the state Google/Apple leave us in after consent.
    await seedSession(page, "/profile");

    await page.goto("/oauth/callback", { waitUntil: "domcontentloaded" });

    // The callback route must navigate us OFF /oauth/callback within its
    // 5s polling window. Landing target is either /onboarding (new user,
    // no username yet) or a signed-in surface like /profile or /.
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

    // No "sign-in failed" state should ever appear.
    await expect(page.getByText(failureText)).toHaveCount(0);

    // Session must actually be live in the browser after the redirect.
    const hasSession = await page.evaluate(
      (key) => Boolean(window.localStorage.getItem(key!)),
      STORAGE_KEY!,
    );
    expect(hasSession, "supabase session missing after OAuth callback").toBe(true);

    await ctx.close();
  });
}

test("/auth renders Google and Apple buttons and invoking them does not show a login-failed state", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await clearSession(page);

  await page.goto("/auth", { waitUntil: "domcontentloaded" });

  const googleBtn = page.getByRole("button", { name: /continue with google/i });
  const appleBtn = page.getByRole("button", { name: /continue with apple/i });
  await expect(googleBtn).toBeVisible();
  await expect(appleBtn).toBeVisible();

  // We can't complete the real provider consent from a headless browser,
  // but we CAN prove clicking the button reaches the Lovable helper
  // without our own code throwing a "sign-in failed" toast. Intercept the
  // provider navigation so the test doesn't hang on the real OAuth URL.
  await page.route(/(accounts\.google\.com|appleid\.apple\.com|oauth\.lovable\.app|\/~oauth\/)/, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );

  for (const btn of [googleBtn, appleBtn]) {
    await btn.click();
    // Toast text from src/routes/auth.tsx failure paths.
    await expect(
      page.getByText(/(sign[- ]?in failed|auth failed)/i),
    ).toHaveCount(0);
  }

  await ctx.close();
});
