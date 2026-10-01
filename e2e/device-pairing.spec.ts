import { expect, test, type Page } from "@playwright/test";
import { HAS_BACKEND, account, signInAs } from "./helpers/fixture-auth";

/**
 * A parent lets their managed child use their own device: pairs it with a
 * code, the device (a second browser context, standing in for the child's own
 * tablet) enters the code and lands signed in with no password, then the
 * parent revokes it and the device is signed out.
 *
 * The manual-entry form checks need no backend. The full flow needs
 * 20261001120000_managed_device_pairing.sql on the E2E project (and, beneath
 * it, 20260930120000_managed_children.sql — a managed child has to exist
 * first), so it probes both and skips with the reason when either is missing.
 *
 * Runs against the shared project, so the child it creates is always deleted
 * again — which also ends the pairing, since the child's auth user is gone.
 */

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

const CHILD_FIRST = "Eetwoepaired";

test.describe("the manual pairing-code form", () => {
  test("accepts only a full-length code, and formats it as it's typed", async ({ page }) => {
    await page.goto("/devices/pair", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /pair this device/i })).toBeVisible({
      timeout: 15_000,
    });
    const submit = page.getByRole("button", { name: /^pair this device$/i });
    const input = page.locator("#pairing-code");
    await expect(submit).toBeDisabled();

    await input.fill("abcde");
    await expect(submit).toBeDisabled();

    await input.fill("abcde12345");
    await expect(input).toHaveValue("ABCDE-12345");
    await expect(submit).toBeEnabled();
  });

  test("prefills from a ?code= link but never auto-submits", async ({ page }) => {
    let submitted = false;
    await page.route("**/_serverFn/**", async (route) => {
      submitted = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto("/devices/pair?code=abcde12345", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#pairing-code")).toHaveValue("ABCDE-12345");
    await page.waitForTimeout(1500);
    expect(submitted).toBe(false);
  });

  test("shows the server's message for a code it doesn't recognise", async ({ page }) => {
    await page.goto("/devices/pair", { waitUntil: "domcontentloaded" });
    await page.locator("#pairing-code").fill("00000000000000000000");
    await page.getByRole("button", { name: /^pair this device$/i }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert")).toHaveText(/isn't valid|something went wrong/i);
  });
});

test.describe("device pairing, end to end", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ request }) => {
    const host = account("host");
    const tokenRes = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      data: { email: host.email, password: host.password },
    });
    const token = tokenRes.ok()
      ? ((await tokenRes.json()) as { access_token?: string }).access_token
      : null;
    // An unapplied migration answers 404 for the function — ask for a code
    // that cannot exist, which a working function answers "invalid" for.
    const probe = token
      ? await request.post(`${SUPABASE_URL}/rest/v1/rpc/lookup_device_pairing`, {
          headers: {
            apikey: PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: { _code_hash: "0".repeat(64) },
        })
      : null;
    test.skip(
      probe?.ok() !== true,
      "E2E backend has not applied 20261001120000_managed_device_pairing.sql.",
    );
  });

  const appears = (locator: ReturnType<Page["getByRole"]>, timeout: number) =>
    locator.waitFor({ state: "visible", timeout }).then(
      () => true,
      () => false,
    );

  async function deleteChild(page: Page) {
    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    const back = page.getByRole("button", { name: /^back to |^sign out$/i });
    if (await appears(back, 5_000)) {
      await back.click();
      await signInAs(page, "host");
      await page.goto("/parent", { waitUntil: "domcontentloaded" });
    }
    const tab = page.getByRole("tab", { name: new RegExp(CHILD_FIRST) });
    if (!(await appears(tab, 15_000))) return;
    await tab.click();
    page.once("dialog", (d) => void d.accept(CHILD_FIRST));
    await page
      .getByRole("button", { name: new RegExp(`delete ${CHILD_FIRST}'s profile`, "i") })
      .click();
    await expect(tab).toBeHidden({ timeout: 20_000 });
  }

  test("pair a device, use it, revoke it", async ({ page, browser }) => {
    await signInAs(page, "host");
    let deviceCtx: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    let retryCtx: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    try {
      // Create the child this spec's pairing lifecycle runs against.
      await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
      await page.locator("#first-name").fill(CHILD_FIRST);
      await page.locator("#dob").fill("2015-04-02");
      await page.locator("#attest").click();
      await page.getByRole("button", { name: /^add child$/i }).click();
      await expect(
        page.getByRole("heading", { name: new RegExp(`${CHILD_FIRST}'s profile is ready`, "i") }),
      ).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: /go to parent center/i }).click();
      await expect(page).toHaveURL(/\/parent/, { timeout: 15_000 });
      await page.getByRole("tab", { name: new RegExp(CHILD_FIRST) }).click();

      // Pair a device: generate a code in the Parent Center.
      await expect(page.getByText(/their own device/i)).toBeVisible();
      await page.getByRole("button", { name: /let them use their own device/i }).click();
      const codeEl = page.getByTestId("pairing-code");
      await expect(codeEl).toBeVisible({ timeout: 15_000 });
      const code = await codeEl.getAttribute("data-code");
      expect(code).toMatch(/^[0-9A-Z]{10}$/);
      await page.keyboard.press("Escape"); // close the dialog; the pairing itself is already created

      // The child's own device: a second, fully separate browser context —
      // no session, no cookies, no localStorage shared with the guardian's.
      deviceCtx = await browser.newContext();
      const devicePage = await deviceCtx.newPage();
      await devicePage.goto("/devices/pair", { waitUntil: "domcontentloaded" });
      await devicePage.locator("#pairing-code").fill(code!);
      await devicePage.getByRole("button", { name: /^pair this device$/i }).click();
      await expect(devicePage).toHaveURL(/\/feed/, { timeout: 30_000 });

      // It is genuinely the child's own session: managed, with no credential
      // surfaces, and no "back to guardian" (nothing was parked on it).
      await expect(devicePage.getByText(new RegExp(`${CHILD_FIRST}.?s device`, "i"))).toBeVisible({
        timeout: 15_000,
      });
      await expect(devicePage.getByRole("button", { name: /^back to /i })).toHaveCount(0);
      await devicePage.goto("/settings", { waitUntil: "domcontentloaded" });
      await expect(devicePage.getByText(/password & sign-in/i)).toHaveCount(0);
      await expect(devicePage.getByText(/^delete account$/i)).toHaveCount(0);

      // A second pairing attempt with the SAME code must fail — it was a
      // read-only lookup the first time, but confirming on the device used it.
      retryCtx = await browser.newContext();
      const retryPage = await retryCtx.newPage();
      await retryPage.goto(`/devices/pair?code=${code}`, { waitUntil: "domcontentloaded" });
      await retryPage.locator("#pairing-code").fill(code!);
      await retryPage.getByRole("button", { name: /^pair this device$/i }).click();
      await expect(retryPage.getByRole("alert")).toBeVisible({ timeout: 15_000 });
      await expect(retryPage.getByRole("alert")).toHaveText(/already used/i);

      // The guardian revokes it: the device gets signed out.
      await page.bringToFront();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: new RegExp(CHILD_FIRST) }).click();
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: /^revoke$/i }).click();
      await expect(page.getByText(/paired —|paired since/i)).toHaveCount(0, { timeout: 15_000 });

      await devicePage.goto("/feed", { waitUntil: "domcontentloaded" });
      await expect(devicePage).toHaveURL(/\/auth/, { timeout: 30_000 });
    } finally {
      if (deviceCtx) await deviceCtx.close();
      if (retryCtx) await retryCtx.close();
      await deleteChild(page);
    }
  });
});
