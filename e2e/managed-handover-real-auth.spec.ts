import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { requireLocalTarget } from "./local-stack/local-only";

/**
 * The adult's side of a managed-account handover in a real browser, against the LOCAL Docker stack (real GoTrue, PostgREST and
 * Postgres) and the app's real server functions: open the emailed link, confirm, choose a password, sign in with it.
 *
 * Runs only on the local stack (`node e2e/local-stack/stack.mjs up`, then `. e2e/local-stack/.state/env.sh`). A spec never
 * holds the service-role key (global-setup removes it from the environment on purpose), so the accounts are made first by
 * `npx vitest run -c vitest.realauth.config.ts e2e/local-stack/handover-browser-seed.itest.ts`, which writes the link to
 * `.state/handover-browser.json`; this spec reads that file once and deletes it (the link is spent by the run). Anywhere else
 * (CI against the hosted sandbox) or without that file, every test here skips and says why.
 *
 * The email cannot be sent here (it goes through Lovable's mail API and the local stack has no mail catcher), so the seed
 * starts the handover with the database call the app's server makes and this spec opens the link it would have mailed. The other
 * behaviours of the same flow that need a real auth server but no browser are proved in
 * e2e/local-stack/managed-handover-real-auth.itest.ts (`npm run test:realauth`).
 */

type Seeded = {
  token: string;
  childId: string;
  childName: string;
  adultEmail: string;
  guardianEmail: string;
  guardianPassword: string;
};

let local: ReturnType<typeof requireLocalTarget> | null = null;
let seeded: Seeded | null = null;
let skipReason = "";
const stateFile = fileURLToPath(
  new URL("./local-stack/.state/handover-browser.json", import.meta.url),
);
try {
  local = requireLocalTarget(process.env);
  if (!existsSync(stateFile)) {
    throw new Error(
      "e2e/local-stack/.state/handover-browser.json is missing: run e2e/local-stack/handover-browser-seed.itest.ts first.",
    );
  }
} catch (e) {
  skipReason = `Needs the local Docker stack and its seed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
}

test.skip(!local || !!skipReason, skipReason || "Needs the local Docker stack.");

const claims = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

test.describe("taking over a handed-over account, in the browser", () => {
  test("the adult opens the link, confirms, chooses a password, and signs in as themselves", async ({
    page,
  }) => {
    seeded = JSON.parse(readFileSync(stateFile, "utf8")) as Seeded;
    unlinkSync(stateFile); // one run per seed: the link is spent below
    const s = seeded;
    const fresh = () =>
      createClient(local!.url, local!.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      });
    const password = `Adult-${randomBytes(6).toString("hex")}-pw1!`;

    await page.goto(`/handover/${s.token}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /take over your ballacity account/i }),
    ).toBeVisible({
      timeout: 30_000,
    });
    // Who is handing over which account, and a masked address, never the address itself.
    await expect(page.getByText(s.childName, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(s.adultEmail)).toHaveCount(0);
    const take = page.getByRole("button", { name: /take over my account/i });
    await expect(take).toBeDisabled();
    await page.getByRole("checkbox").check();
    await take.click();

    // The server did its steps against the real auth server and handed back a one-time sign-in; now a password.
    await page.locator("#handover-password").fill(password, { timeout: 60_000 });
    await page.locator("#handover-password-again").fill(password);
    await page.getByRole("button", { name: /save password/i }).click();
    await expect(page.getByText(/this account is yours/i)).toBeVisible({ timeout: 30_000 });

    // The browser's own session is the adult's, not managed.
    const stored = await page.evaluate(
      () => Object.entries(window.localStorage).find(([k]) => /^sb-.*-auth-token$/.test(k))?.[1],
    );
    const session = JSON.parse(stored ?? "{}") as { access_token?: string; user?: { id?: string } };
    expect(session.user?.id).toBe(s.childId);
    expect(
      claims(session.access_token!)["app_metadata"] as Record<string, unknown>,
    ).not.toMatchObject({
      managed: true,
    });

    // The chosen password signs in with the adult's own address against the real server, and the guardian's account is untouched.
    const adult = await fresh().auth.signInWithPassword({ email: s.adultEmail, password });
    expect(adult.error).toBeNull();
    expect(adult.data.user?.id).toBe(s.childId);
    const guardian = await fresh().auth.signInWithPassword({
      email: s.guardianEmail,
      password: s.guardianPassword,
    });
    expect(guardian.error).toBeNull();

    // Through the real sign-in form too, as the person will next time.
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Email").fill(s.adultEmail);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page).not.toHaveURL(/\/auth(?:[?#].*)?$/, { timeout: 30_000 });

    // The link is spent: opening it again says so and changes nothing.
    await page.goto(`/handover/${s.token}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/this link isn't valid any more/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /take over my account/i })).toHaveCount(0);
  });
});
