import type { BrowserContext, Page } from "@playwright/test";
import { SAFETY_ACK_VERSION } from "../../src/lib/safety";

/**
 * Precondition for specs that tap a join, request or pay CTA on a game page:
 * the member has already accepted the current physical-activity risk
 * acknowledgment for that game.
 *
 * Since the risk gate landed (src/lib/safety.ts `needsRiskAcknowledgment`), the
 * first join action on a game opens RiskAcknowledgmentDialog instead of joining,
 * until `game_safety_acknowledgments` holds a row at SAFETY_ACK_VERSION. The
 * specs below predate the gate and exercise what happens AFTER it, so without
 * this every CTA tap stopped at the dialog and the join_requests /
 * game_participants writes they wait for never fired.
 *
 * Pass a BrowserContext to cover every page in it (multi-device specs).
 * Only that table's reads are answered; everything else falls through. Call it
 * after the spec's own routes so it wins for this one URL (Playwright runs the
 * most recently registered matching route first).
 */
export async function stubRiskAcknowledged(target: Page | BrowserContext) {
  await target.route(/\/rest\/v1\/game_safety_acknowledgments(?:\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([
        { version: SAFETY_ACK_VERSION, accepted_at: new Date().toISOString() },
      ]),
    });
  });
}
