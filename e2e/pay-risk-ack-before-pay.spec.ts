import { test, expect, type Page, type Route } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import { PAY_FIXTURE_HOST_ID, payFixtureGameRow, serveFixtureGame } from "./helpers/pay-fixtures";
import {
  currentSafetyAckVersion,
  mockRiskNotAcknowledged,
  watchRiskDialog,
} from "./helpers/risk-ack";

/**
 * E2E: "Before you join" on the pay page (docs/paid-path-gates.md section 7, Option B, owner decision 2026-11-18).
 *
 * A paid game that needs no host approval sends a player from the game page straight to /games/<id>/pay by a link,
 * and the pay page can be opened directly, so the game page's join tap (which asks the risk acknowledgment) never
 * runs for them. The pay page asks it itself, before any payment option is drawn. This spec serves the acknowledgment
 * as not given (mockRiskNotAcknowledged) to a fresh viewer of a paid open game and checks that:
 *
 *   - the real dialog opens on arrival, and nothing payable (no Venmo or Cash App handle or link, no proof form) is
 *     on the page at any point before the acknowledgment is recorded;
 *   - Cancel closes it, records nothing and writes no payment; the page stays, with no payment options, a way to
 *     open the dialog again and a way back to the game;
 *   - ticking the box and "Agree & join" records exactly one participant_risk acknowledgment for the current version
 *     (the join path's write), and only then are the host's handles shown.
 *
 * And, around it:
 *
 *   - on a game whose host requires approval (the default setting), the dialog never opens before the host's payment
 *     settings have answered, however late they are: those settings put "Waiting on host approval" first, and the
 *     dialog used to open, then close by itself when they arrived;
 *   - when the settings cannot be read, the page offers its Retry card, not the dialog; after a Retry that succeeds,
 *     the dialog asks;
 *   - when the acknowledgment read keeps failing, the dialog asks (fail closed), and once the write succeeds the
 *     handles show even though the re-read still fails (the write's own answer lifts the dialog, as on the join path).
 *
 * The game row, the host's settings and methods, the viewer's request, payments and place, and the guardian check are
 * served, and every acknowledgment or payment write is captured, so nothing depends on, or is written to, the backend.
 *
 * Auto-skips when no signed-in Supabase session is available.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const HOST_ID = PAY_FIXTURE_HOST_ID;
const ENTRY_FEE = 12;
const VENMO_HANDLE = "e2e-riskack-venmo";
const CASHTAG = "e2eriskackcash";

function sessionUserId(): string {
  const s = JSON.parse(SESSION_JSON!);
  const id: string | undefined = s?.user?.id;
  expect(id, "session must contain user.id").toBeTruthy();
  return id!;
}

const isTable = (url: URL | string, table: string) => String(url).includes(`/rest/v1/${table}`);

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

type SettingsMock = {
  /** game_payment_settings.requires_approval (default false: an open game). */
  requiresApproval?: boolean;
  /** Hold the settings read this long before answering. */
  settingsDelayMs?: number;
};

/**
 * A paid game (open unless `requiresApproval`), two manual methods, and a viewer with no request, payment or place.
 * Setting `settingsFail.value` makes the settings read answer 500 until it is set back.
 */
async function mockPaidOpenGame(
  page: Page,
  opts: SettingsMock = {},
): Promise<{ paymentWrites: string[]; settingsFail: { value: boolean } }> {
  const now = new Date().toISOString();
  const paymentWrites: string[] = [];
  const settingsFail = { value: false };
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      if (opts.settingsDelayMs) await new Promise((r) => setTimeout(r, opts.settingsDelayMs));
      if (settingsFail.value) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "e2e: settings unavailable" }),
        });
        return;
      }
      await fulfillJson(route, [
        {
          id: "mock-settings-riskack",
          game_id: GAME_ID,
          host_id: HOST_ID,
          entry_fee: ENTRY_FEE,
          accepted_method_ids: ["mock-venmo", "mock-cashapp"],
          payment_deadline: null,
          refund_policy: null,
          payment_instructions: null,
          requires_approval: opts.requiresApproval ?? false,
          created_at: now,
          updated_at: now,
        },
      ]);
    },
  );
  const method = (over: Record<string, unknown>) => ({
    host_id: HOST_ID,
    payment_url: null,
    contact_info: null,
    instructions: null,
    is_enabled: true,
    created_at: now,
    updated_at: now,
    ...over,
  });
  await page.route(
    (u) =>
      isTable(u, "host_payment_methods") ||
      String(u).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (!["GET", "POST"].includes(route.request().method())) return route.fallback();
      await fulfillJson(route, [
        method({ id: "mock-venmo", payment_type: "venmo", label: "Venmo", username: VENMO_HANDLE }),
        method({
          id: "mock-cashapp",
          payment_type: "cashapp",
          label: "Cash App",
          username: CASHTAG,
        }),
      ]);
    },
  );
  for (const table of ["join_requests", "game_participants"]) {
    await page.route(
      (u) => isTable(u, table),
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        await fulfillJson(route, []);
      },
    );
  }
  // No payment of theirs yet; any payment write is captured, never sent.
  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") return fulfillJson(route, []);
      paymentWrites.push(`${req.method()} ${req.url()}`);
      await route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    },
  );
  // The guardian check, as the database answers it for an adult.
  await page.route(
    (u) => String(u).includes("/rest/v1/rpc/game_payment_guardian_ready"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await fulfillJson(route, true);
    },
  );
  await serveFixtureGame(page, payFixtureGameRow(GAME_ID, { price: ENTRY_FEE }));
  return { paymentWrites, settingsFail };
}

/** Nothing on the page lets money move: no handle, no Venmo or Cash App link, no proof form. */
async function expectNoPaymentOffered(page: Page) {
  await expect(page.getByRole("button", { name: /^pay \$\d+ in venmo$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^pay \$\d+ in cash app$/i })).toHaveCount(0);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByText(CASHTAG)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /i have paid/i })).toHaveCount(0);
}

test("a paid open game: the pay page asks 'Before you join' before any payment option; Cancel shows none and writes nothing", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const riskAck = await mockRiskNotAcknowledged(page);
  const { paymentWrites } = await mockPaidOpenGame(page);
  // Record whether a handle is ever drawn, however briefly, and how many acknowledgments had been written by then.
  await page.addInitScript(
    ([venmo, cash]) => {
      const w = window as unknown as { __handleSeen?: boolean };
      w.__handleSeen = false;
      new MutationObserver(() => {
        const text = document.body?.innerText ?? "";
        if (text.includes(venmo!) || text.includes(cash!)) w.__handleSeen = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    },
    [VENMO_HANDLE, CASHTAG],
  );
  const handleSeen = () =>
    page.evaluate(() => !!(window as unknown as { __handleSeen?: boolean }).__handleSeen);

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const dialog = page.getByRole("dialog", { name: /before you join/i });
  const checkbox = dialog.getByRole("checkbox");
  const agree = dialog.getByRole("button", { name: /^agree & join$/i });

  // 1. The dialog opens on arrival, unticked, over a page with nothing payable.
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(agree).toBeDisabled();
  await expectNoPaymentOffered(page);

  // 2. Cancel: the dialog closes, the page stays with no payment options, a way back to the game, and nothing written.
  await dialog.getByRole("button", { name: /^cancel$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  const card = page.getByTestId("pay-risk-ack-required");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/before you join/i);
  await expect(card.getByRole("link", { name: /back to game/i })).toHaveAttribute(
    "href",
    `/games/${GAME_ID}`,
  );
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);
  await page.waitForTimeout(500);
  await expectNoPaymentOffered(page);
  expect(riskAck.writes, "Cancel must not record an acknowledgment").toEqual([]);
  expect(paymentWrites, "Cancel must not write a payment").toEqual([]);
  expect(await handleSeen(), "no handle was drawn before the acknowledgment").toBe(false);

  // 3. "Review and agree" opens it again, unticked; agreeing records exactly one acknowledgment, then the handles show.
  await card.getByRole("button", { name: /review and agree/i }).click();
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await checkbox.click();
  await expect(agree).toBeEnabled();
  await agree.click();

  await expect
    .poll(() => riskAck.writes.length, { timeout: 10_000, message: "acknowledgment never sent" })
    .toBe(1);
  expect(riskAck.writes[0]).toMatchObject({
    kind: "participant_risk",
    version: currentSafetyAckVersion(),
    game_id: GAME_ID,
    user_id: userId,
  });
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("pay-risk-ack-required")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Venmo` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Cash App` })).toBeVisible();
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible();
  expect(riskAck.writes, "one acknowledgment, not one per render").toHaveLength(1);
  expect(paymentWrites).toEqual([]);

  await ctx.close();
});

test("an approval-gated paid game: 'Before you join' never opens before the host's settings answer, however late", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const riskAck = await mockRiskNotAcknowledged(page);
  // The settings answer well after the viewer's request, payments and acknowledgment reads.
  const { paymentWrites } = await mockPaidOpenGame(page, {
    requiresApproval: true,
    settingsDelayMs: 3_000,
  });
  const dialogSeen = await watchRiskDialog(page);

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 20_000 });
  await expect(gate).toContainText(/send a request to join first/i);
  await page.waitForTimeout(1_000);
  expect(
    await dialogSeen(),
    "the dialog must not open before the settings put the approval card first",
  ).toBe(false);
  await expect(page.getByRole("dialog", { name: /before you join/i })).toHaveCount(0);
  await expectNoPaymentOffered(page);
  expect(riskAck.writes).toEqual([]);
  expect(paymentWrites).toEqual([]);

  await ctx.close();
});

test("a paid open game whose settings cannot be read: the Retry card, not the dialog; after a good Retry, the dialog", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const riskAck = await mockRiskNotAcknowledged(page);
  const { paymentWrites, settingsFail } = await mockPaidOpenGame(page);
  settingsFail.value = true;
  const dialogSeen = await watchRiskDialog(page);

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText(/couldn't reach the payment service/i)).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1_000);
  expect(await dialogSeen(), "no dialog in front of 'Couldn't reach the payment service'").toBe(
    false,
  );
  await expectNoPaymentOffered(page);

  settingsFail.value = false;
  await page.getByRole("button", { name: /^retry$/i }).click();
  const dialog = page.getByRole("dialog", { name: /before you join/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expectNoPaymentOffered(page);
  expect(riskAck.writes).toEqual([]);
  expect(paymentWrites).toEqual([]);

  await ctx.close();
});

test("a failing acknowledgment read: the dialog asks, and after a successful write the handles show", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const riskAck = await mockRiskNotAcknowledged(page);
  // Every participant_risk read fails (registered after the mock, so it answers first); writes still reach the mock.
  let failedReads = 0;
  await page.route(/\/rest\/v1\/game_safety_acknowledgments(\?|$)/, async (route) => {
    const req = route.request();
    const isRiskRead =
      req.method() === "GET" &&
      new URL(req.url()).searchParams.get("kind") === "eq.participant_risk";
    if (!isRiskRead) return route.fallback();
    failedReads += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "e2e: acknowledgments unavailable" }),
    });
  });
  const { paymentWrites } = await mockPaidOpenGame(page);

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  // react-query retries a failed first read (about 7 s) before the page counts it as failed and asks.
  const dialog = page.getByRole("dialog", { name: /before you join/i });
  await expect(dialog).toBeVisible({ timeout: 25_000 });
  await expectNoPaymentOffered(page);
  const readsBeforeAgree = failedReads;
  await dialog.getByRole("checkbox").click();
  await dialog.getByRole("button", { name: /^agree & join$/i }).click();

  await expect
    .poll(() => riskAck.writes.length, { timeout: 10_000, message: "acknowledgment never sent" })
    .toBe(1);
  expect(riskAck.writes[0]).toMatchObject({
    kind: "participant_risk",
    version: currentSafetyAckVersion(),
    game_id: GAME_ID,
    user_id: userId,
  });
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Venmo` })).toBeVisible({
    timeout: 15_000,
  });
  // The re-read after the write fails too: the write's own answer lifted the dialog, and it stays lifted.
  await expect.poll(() => failedReads, { timeout: 15_000 }).toBeGreaterThan(readsBeforeAgree);
  await page.waitForTimeout(500);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible();
  expect(riskAck.writes).toHaveLength(1);
  expect(paymentWrites).toEqual([]);

  await ctx.close();
});
