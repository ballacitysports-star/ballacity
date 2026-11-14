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
 * Specs about joins, payments and realtime that are not testing the gate itself
 * (src/lib/safety.test.ts covers its rules) serve the viewer's acknowledgment
 * as already given for the current version (stubRiskAcknowledged). The version
 * is read from the app's source so the stub cannot drift from it.
 *
 * Specs that need the dialog to be due serve it as not given and capture the
 * write (mockRiskNotAcknowledged): risk-ack-before-join exercises the dialog
 * itself, and the expired and tampered invite specs check that a refused join
 * never opens it.
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

/** The acknowledgment the join gate reads (useSafetyAck in src/lib/safety-acks.ts). */
function isParticipantRiskRead(url: string): boolean {
  return new URL(url).searchParams.get("kind") === "eq.participant_risk";
}

const ACK_TABLE = /\/rest\/v1\/game_safety_acknowledgments(\?|$)/;

/**
 * Serve the viewer's risk acknowledgment as given for the current version, so
 * the join CTA goes straight to the join flow. Install before the page loads.
 *
 * Only the participant_risk read is answered; any other acknowledgment query
 * (host_responsibility) and every write go to the backend as usual.
 *
 * A tap that lands before this read has answered does not open the dialog: the
 * page waits for the read before it decides (handleJoin in
 * src/routes/games.$gameId.index.tsx), so specs need no wait of their own.
 */
export async function stubRiskAcknowledged(page: Page): Promise<void> {
  const version = currentSafetyAckVersion();
  await page.route(ACK_TABLE, async (route) => {
    const req = route.request();
    if (req.method() !== "GET" || !isParticipantRiskRead(req.url())) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ version, accepted_at: new Date().toISOString() }]),
    });
  });
}

export type RiskAckWrite = {
  kind?: string;
  version?: string;
  game_id?: string;
  user_id?: string;
};

/** What the page did with the mocked acknowledgment (see mockRiskNotAcknowledged). */
export type RiskAckMock = {
  /** participant_risk acknowledgments the page tried to record, in order. */
  writes: RiskAckWrite[];
};

/**
 * Serve the viewer as NOT having acknowledged this game yet, so a join opens
 * the real "Before you join" dialog whatever the backend holds, and capture
 * every participant_risk acknowledgment the page writes instead of storing it.
 * Once one is written, reads return it, as the backend would. Install before
 * the page loads.
 */
export async function mockRiskNotAcknowledged(page: Page): Promise<RiskAckMock> {
  const mock: RiskAckMock = { writes: [] };
  await page.route(ACK_TABLE, async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      if (!isParticipantRiskRead(req.url())) return route.fallback();
      const last = mock.writes.at(-1);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          last ? [{ version: last.version, accepted_at: new Date().toISOString() }] : [],
        ),
      });
      return;
    }
    let body: unknown = null;
    try {
      body = JSON.parse(req.postData() ?? "null");
    } catch {
      /* not JSON */
    }
    const rows = (Array.isArray(body) ? body : [body]) as Array<RiskAckWrite | null>;
    const risk = rows.filter((r): r is RiskAckWrite => r?.kind === "participant_risk");
    if (risk.length === 0) return route.fallback();
    mock.writes.push(...risk);
    // recordSafetyAck upserts without asking for the row back.
    await route.fulfill({ status: 201, body: "" });
  });
  return mock;
}

/**
 * Record whether the "Before you join" dialog is ever shown on this page, even
 * briefly or before a navigation unmounts it. Install before the page loads;
 * the returned function reads the flag.
 */
export async function watchRiskDialog(page: Page): Promise<() => Promise<boolean>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __riskDialogSeen?: boolean };
    w.__riskDialogSeen = false;
    const check = () => {
      if (w.__riskDialogSeen) return;
      for (const d of Array.from(document.querySelectorAll('[role="dialog"]'))) {
        if (/before you join/i.test(d.textContent ?? "")) w.__riskDialogSeen = true;
      }
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
  });
  return () =>
    page.evaluate(() => !!(window as unknown as { __riskDialogSeen?: boolean }).__riskDialogSeen);
}
