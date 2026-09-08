import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers/fixture-auth";

/**
 * Stage 2: a parent adds a child, and the child never gets a login.
 *
 * This lives in E2E rather than in the unit suite because the guarantee is a
 * database one — player_profiles.user_id staying null, and age_cohort being
 * derived by trigger from the birthday — and neither can be observed without a
 * real authenticated session against the real backend. The unit tests cover
 * the shape of the insert; only this covers the screen actually working.
 *
 * The rows created here are cleaned up at the end of each test, since this
 * suite runs against the shared project.
 */

const CHILD_FIRST = "E2EStageTwo";

test.afterEach(async ({ page }) => {
  // This suite runs against the shared project, so it must not leave rows
  // behind. DELETE targets the signed-in account's own player_profiles rows,
  // which RLS already permits — no service-role key involved.
  //
  // Done through PostgREST with the session the browser is holding rather
  // than through the UI, because there is deliberately no delete button yet.
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;

  await page
    .evaluate(
      async ([base, apikey, first]) => {
        const entry = Object.keys(localStorage).find(
          (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
        );
        if (!entry) return "no session";
        let token: string | undefined;
        try {
          token = JSON.parse(localStorage.getItem(entry) as string)?.access_token;
        } catch {
          return "unparseable session";
        }
        if (!token) return "no access token";
        const res = await fetch(
          `${base}/rest/v1/player_profiles?first_name=eq.${encodeURIComponent(first)}`,
          {
            method: "DELETE",
            headers: { apikey, Authorization: `Bearer ${token}` },
          },
        );
        return `${res.status}`;
      },
      [url, key, CHILD_FIRST] as const,
    )
    .catch(() => "cleanup skipped");
});

test("a parent adds a child, who gets no login", async ({ page }) => {
  await signInAs(page, "player");

  await page.goto("/players/add", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /add a player/i })).toBeVisible({
    timeout: 15_000,
  });

  // "Who is this player?" — Child is the case that matters.
  await page.getByRole("button", { name: "Child", exact: true }).click();
  await expect(page.getByText(/doesn't need their own login/i)).toBeVisible();

  await page.locator("#first-name").fill(CHILD_FIRST);
  await page.locator("#last-name").fill("Tester");
  await page.locator("#dob").fill("2015-04-02");
  // By value, not label: the option's text is "🏀 Basketball" (the emoji is
  // part of it) and selectOption matches labels exactly, so a label of
  // "Basketball" would not match. The value attribute is the bare sport name.
  await page.locator("#sport").selectOption("Basketball");

  await page.getByRole("button", { name: /create player/i }).click();

  // The confirmation, not a raw error (§23).
  await expect(page.getByRole("heading", { name: /player created/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/let's build .* profile when you're ready/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /do this later/i })).toBeVisible();
});

test("the sport is optional, the name and birthday are not", async ({ page }) => {
  await signInAs(page, "player");
  await page.goto("/players/add", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /add a player/i })).toBeVisible({
    timeout: 15_000,
  });

  const create = page.getByRole("button", { name: /create player/i });
  await expect(create).toBeDisabled();

  await page.getByRole("button", { name: "Child", exact: true }).click();
  await page.locator("#first-name").fill(CHILD_FIRST);
  // Still no birthday.
  await expect(create).toBeDisabled();

  await page.locator("#dob").fill("2015-04-02");
  // No sport chosen, and it must not block: onboarding is not a resume form.
  await expect(create).toBeEnabled();
});

test("onboarding asks who the account is for", async ({ page }) => {
  await signInAs(page, "player");
  await page.goto("/onboarding/setup-for", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: /who are you setting up ballacity for/i }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole("button", { name: /i'm playing$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /setting this up for my child/i })).toBeVisible();

  // Continue stays disabled until a choice is made.
  const cont = page.getByRole("button", { name: /^continue$/i });
  await expect(cont).toBeDisabled();
  await page.getByRole("button", { name: /setting this up for my child/i }).click();
  await expect(cont).toBeEnabled();
  await cont.click();
  await expect(page).toHaveURL(/\/players\/add/, { timeout: 15_000 });
});
