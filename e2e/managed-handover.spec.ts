import { expect, test } from "@playwright/test";
import { HAS_BACKEND, account, signInAs } from "./helpers/fixture-auth";

/**
 * Handing a managed account over to the adult it belongs to (20261128100000, docs/managed-account-handover.md).
 *
 * What a run can check without a seeded managed adult (a person can only become a known adult by their birthday passing,
 * which a spec cannot make happen): the emailed link's page, what the Parent Center offers a guardian who has no managed
 * adult, and that the database's grants hold on the real stack (a signed-in guardian can list and cancel, and can never
 * start, claim or finish a handover; only the app's server can). The full journey is rehearsed against a local database in
 * supabase/tests/991_managed_account_handover.test.sql and against the mocked Admin API in
 * src/lib/managed-handover.server.test.ts.
 *
 * Each check that needs the migration probes the backend first and skips with the reason when it is missing: the app
 * deploys separately from the migration and must keep working without it.
 */

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

test.describe("the emailed handover link", () => {
  test("a link that was never issued says it is not valid, offers sign-in, and changes nothing", async ({
    page,
  }) => {
    await page.goto(`/handover/${"0".repeat(64)}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /take over your ballacity account/i }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/this link isn't valid any more/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("link", { name: /go to sign in/i })).toBeVisible();
    // Nothing to confirm, and no way to go on.
    await expect(page.getByRole("button", { name: /take over my account/i })).toHaveCount(0);
  });

  test("opens signed out (it is not sent to sign in) and keeps its token out of the referrer", async ({
    page,
  }) => {
    await page.goto(`/handover/${"1".repeat(64)}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/handover\//, { timeout: 20_000 });
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});

test.describe("the Parent Center and the database, on the real stack", () => {
  /** The host's own token, and whether the migration is on this backend. */
  async function guardianToken(request: import("@playwright/test").APIRequestContext) {
    const host = account("host");
    const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      data: { email: host.email, password: host.password },
    });
    return res.ok()
      ? (((await res.json()) as { access_token?: string }).access_token ?? null)
      : null;
  }
  const rpc = (
    request: import("@playwright/test").APIRequestContext,
    token: string,
    name: string,
    data: Record<string, unknown>,
  ) =>
    request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data,
    });

  test("a guardian with no managed adult is offered no handover", async ({ page }) => {
    await signInAs(page, "host");
    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /parent center/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/hand over/i)).toHaveCount(0);
    await expect(page.getByTestId("managed-handover")).toHaveCount(0);
  });

  test("a signed-in guardian can list, but never start, claim, finish or look up a handover", async ({
    request,
  }) => {
    const token = await guardianToken(request);
    test.skip(!token, "Could not sign in as the test guardian.");
    const list = await rpc(request, token!, "guardian_managed_handovers", {});
    test.skip(
      !list.ok(),
      "E2E backend has not applied 20261128100000_managed_account_handover.sql.",
    );
    expect(await list.json()).toEqual([]);

    const hash = "a".repeat(64);
    for (const [name, args] of [
      ["finish_managed_handover", { _token_hash: hash }],
      ["claim_managed_handover", { _token_hash: hash }],
      ["release_managed_handover", { _token_hash: hash }],
      ["managed_handover_lookup", { _token_hash: hash }],
    ] as const) {
      const res = await rpc(request, token!, name, args);
      expect(res.ok(), `${name} must not be callable by a signed-in user`).toBe(false);
      expect([401, 403, 404]).toContain(res.status());
    }

    // Starting is the server's alone: a signed-in guardian cannot call it with a token of their own choosing, which would
    // let them follow their own link without receiving the email.
    const start = await rpc(request, token!, "start_managed_handover", {
      _guardian: "00000000-0000-4000-8000-000000000001",
      _child: "00000000-0000-4000-8000-000000000000",
      _email: "someone@example.test",
      _token_hash: hash,
    });
    expect(start.ok(), "start_managed_handover must not be callable by a signed-in user").toBe(
      false,
    );
    expect([401, 403, 404]).toContain(start.status());
  });

  test("a visitor with no sign-in can call none of it", async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/guardian_managed_handovers`, {
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      data: {},
    });
    // 404 where the migration is not applied; otherwise refused.
    expect(res.ok()).toBe(false);
  });
});
