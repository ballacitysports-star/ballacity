import { fulfillRows } from "./helpers/invite-postgrest";
import { currentSafetyAckVersion, mockRiskNotAcknowledged } from "./helpers/risk-ack";
import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: the real "Before you join" risk acknowledgment stands between a player
 * and a join.
 *
 * Every other spec that reaches a join serves the acknowledgment as already
 * given (stubRiskAcknowledged). This one serves it as not given yet and lets
 * the real dialog open:
 *
 *   - tapping "Request Spot" opens "Before you join", with the checkbox clear
 *     and "Agree & join" disabled;
 *   - nothing is joined or requested (no join_requests or game_participants
 *     write) while the dialog is open, nor after Cancel;
 *   - Cancel closes it and records nothing; the next tap asks again;
 *   - ticking the checkbox and "Agree & join" records the participant_risk
 *     acknowledgment for the current version, and only then does the join
 *     request go out, landing on the pending UI.
 *
 * Every write is mocked (the acknowledgment, the join request, any roster
 * insert) and the game's settings are served, so the spec does not depend on
 * what the backend holds for this account and writes nothing to it. That keeps
 * it valid on the local stack and on the hosted sandbox alike.
 *
 * Auto-skips without a restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const FAKE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

function sessionUserId(): string {
  const s = JSON.parse(SESSION_JSON!);
  const id: string | undefined = s?.user?.id;
  expect(id, "session must contain user.id").toBeTruthy();
  return id!;
}

const isTable = (url: string, table: string) => String(url).includes(`/rest/v1/${table}`);

test("join waits for the Before you join acknowledgment, and Cancel joins nothing", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Not acknowledged yet: the join opens the real dialog. Acknowledgment
  // writes are captured, not stored.
  const riskAck = await mockRiskNotAcknowledged(page);
  // Join writes, each with how many acknowledgments had been recorded by then.
  const joinWrites: Array<{ table: string; method: string; body: unknown; acksBefore: number }> =
    [];

  // Approval-gated game, so the CTA sends a join request straight after the
  // acknowledgment (no "Join this run?" step in between).
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "mock-settings-id",
            game_id: GAME_ID,
            host_id: FAKE_HOST_ID,
            entry_fee: 0,
            accepted_method_ids: [],
            payment_deadline: null,
            refund_policy: null,
            payment_instructions: null,
            requires_approval: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    },
  );
  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  const pendingRow = () => ({
    id: "mock-join-id",
    game_id: GAME_ID,
    host_id: FAKE_HOST_ID,
    player_id: userId,
    status: "pending",
    message: null,
    reviewer_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const parse = (raw: string | null) => {
    try {
      return JSON.parse(raw ?? "null");
    } catch {
      return null;
    }
  };

  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const req = route.request();
      if (req.method() === "GET") {
        const sent = joinWrites.some((w) => w.table === "join_requests");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(sent ? [pendingRow()] : []),
        });
        return;
      }
      joinWrites.push({
        table: "join_requests",
        method: req.method(),
        body: parse(req.postData()),
        acksBefore: riskAck.writes.length,
      });
      await fulfillRows(route, [pendingRow()], { status: 201 });
    },
  );
  // A roster insert must not happen on this game at all; capture it rather than
  // let it reach the backend.
  await page.route(
    (u) => isTable(u, "game_participants"),
    async (route: PWRoute) => {
      const req = route.request();
      if (req.method() === "GET") {
        // The viewer must start off the roster wherever this runs: on a shared
        // sandbox a crashed earlier run could have left them on g2. Pass the
        // real roster through without the viewer's own row.
        const res = await route.fetch();
        let rows: unknown = null;
        try {
          rows = await res.json();
        } catch {
          return route.fulfill({ response: res });
        }
        const notViewer = (r: unknown) => (r as { user_id?: string } | null)?.user_id !== userId;
        const body = Array.isArray(rows) ? rows.filter(notViewer) : notViewer(rows) ? rows : null;
        return route.fulfill({ response: res, json: body });
      }
      joinWrites.push({
        table: "game_participants",
        method: req.method(),
        body: parse(req.postData()),
        acksBefore: riskAck.writes.length,
      });
      await route.fulfill({ status: 201, body: "" });
    },
  );

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("button", { name: /^request spot/i }).first();
  const dialog = page.getByRole("dialog", { name: /before you join/i });
  const checkbox = dialog.getByRole("checkbox");
  const agree = dialog.getByRole("button", { name: /^agree & join$/i });

  // 1. The tap opens the dialog, unticked, and joins nothing.
  await expect(cta).toBeVisible({ timeout: 15_000 });
  await cta.click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(agree).toBeDisabled();
  await page.waitForTimeout(500);
  expect(joinWrites, "nothing may be joined while the dialog is open").toEqual([]);
  expect(riskAck.writes, "nothing is acknowledged by opening the dialog").toEqual([]);

  // 2. Cancel closes it and records nothing.
  await dialog.getByRole("button", { name: /^cancel$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  await page.waitForTimeout(500);
  expect(joinWrites, "Cancel must not join").toEqual([]);
  expect(riskAck.writes, "Cancel must not record an acknowledgment").toEqual([]);
  await expect(cta).toBeVisible();

  // 3. Still not acknowledged: the next tap asks again, unticked.
  await cta.click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(agree).toBeDisabled();
  expect(joinWrites).toEqual([]);

  // 4. Tick and agree: the acknowledgment is recorded, then the request goes out.
  await checkbox.click();
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
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

  await expect
    .poll(() => joinWrites.length, { timeout: 10_000, message: "join request never sent" })
    .toBe(1);
  expect(joinWrites[0]!.table).toBe("join_requests");
  expect(joinWrites[0]!.method).toBe("POST");
  expect(joinWrites[0]!.body).toMatchObject({
    game_id: GAME_ID,
    host_id: FAKE_HOST_ID,
    player_id: userId,
  });
  // The request went out only once the acknowledgment had been recorded.
  expect(joinWrites[0]!.acksBefore).toBe(1);

  await expect(dialog).toBeHidden({ timeout: 5_000 });
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });

  await ctx.close();
});
