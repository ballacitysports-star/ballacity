import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Signed-in user with no username lands on /onboarding after visiting
 * /auth, and completing onboarding routes to /profile.
 *
 * We seed the Supabase session that Lovable injects into the sandbox, then
 * clear the profile's `username` via PostgREST so AuthGate's onboarding
 * check flips to `true`. After walking through the 4 onboarding steps, the
 * finish handler persists the username and navigates to /profile.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

function parseUserId(sessionJson: string): string {
  const parsed = JSON.parse(sessionJson) as { user?: { id?: string } };
  const id = parsed.user?.id;
  if (!id) throw new Error("Session JSON missing user.id");
  return id;
}

function accessTokenFrom(sessionJson: string): string {
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  const parsed = JSON.parse(sessionJson) as { access_token?: string };
  if (!parsed.access_token) throw new Error("Session JSON missing access_token");
  return parsed.access_token;
}

async function setUsername(userId: string, token: string, username: string | null) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON!,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ username }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to set username: ${res.status} ${await res.text()}`);
  }
}

async function seedSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key!, value!);
    },
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

test.describe("google sign-in → onboarding → profile", () => {
  test.skip(
    !SESSION_JSON || !STORAGE_KEY || !SUPABASE_URL || !SUPABASE_ANON,
    "Requires a signed-in Supabase session and Supabase env vars.",
  );

  test("no username → /onboarding, finish → /profile", async ({ browser }) => {
    const userId = parseUserId(SESSION_JSON!);
    const token = accessTokenFrom(SESSION_JSON!);

    // Start clean: no username so AuthGate sends us to onboarding.
    await setUsername(userId, token, null);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await seedSession(page);
      await page.goto("/auth", { waitUntil: "domcontentloaded" });

      // AuthGate should route the signed-in, un-onboarded user to /onboarding.
      await page.waitForURL((url) => url.pathname === "/onboarding", {
        timeout: 15_000,
      });

      // Step 1 — pick a unique username.
      const uniqueUsername = `e2e_${Date.now().toString(36)}`.slice(0, 20);
      await page.getByPlaceholder("yourname").fill(uniqueUsername);
      const continueBtn = page.getByRole("button", { name: /^continue$/i }).first();
      await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
      await continueBtn.click();

      // Step 2 — skip photo.
      await page.getByRole("button", { name: /skip for now/i }).click();

      // Step 3 — skip location.
      await page.getByRole("button", { name: /skip for now/i }).click();

      // Step 4 — finish without picking sports.
      await page.getByRole("button", { name: /skip & finish|finish/i }).click();

      await page.waitForURL((url) => url.pathname.startsWith("/profile"), {
        timeout: 15_000,
      });

      expect(new URL(page.url()).pathname).toMatch(/^\/profile/);
    } finally {
      // Restore username so subsequent runs remain idempotent.
      await setUsername(userId, token, `e2e_${userId.slice(0, 8)}`).catch(() => {});
      await ctx.close();
    }
  });
});
