/**
 * The "Before you join" risk acknowledgment, for specs that serve a game's rows
 * from route mocks.
 *
 * Joining a game asks a player to acknowledge the activity's risks once per
 * acknowledgment version per game (`needsRiskAcknowledgment` in
 * src/lib/safety.ts). The dialog covers the page, so a spec written before the
 * gate that taps "Request to join" or "Join" sees the dialog open and no
 * join_requests POST. Recording the acknowledgment writes a real row, which a
 * mocked sample game (`g1`) cannot have.
 *
 * Specs about invites, payments and realtime are not testing the gate itself
 * (src/lib/safety.test.ts covers its rules), so they serve the viewer's
 * acknowledgment as already given for the current version. The version is read
 * from the app's source so the stub cannot drift from it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

/** `SAFETY_ACK_VERSION` from src/lib/safety.ts. Throws if it can no longer be found. */
export function currentSafetyAckVersion(): string {
  const src = readFileSync(join(here, "..", "..", "src", "lib", "safety.ts"), "utf8");
  const m = src.match(/export const SAFETY_ACK_VERSION\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("SAFETY_ACK_VERSION not found in src/lib/safety.ts");
  return m[1]!;
}

/**
 * Serve the viewer's risk acknowledgment as given for the current version, so
 * the join CTA goes straight to the join flow. Install before the page loads.
 */
export async function stubRiskAcknowledged(page: Page): Promise<void> {
  const version = currentSafetyAckVersion();
  await page.route(/\/rest\/v1\/game_safety_acknowledgments(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ version, accepted_at: new Date().toISOString() }]),
    });
  });
}
