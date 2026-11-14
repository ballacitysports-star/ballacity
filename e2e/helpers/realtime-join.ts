/**
 * Join and leave a free, no-approval run (the seeded `g1`) from its game page,
 * the way a player does today, for the realtime specs.
 *
 * Those specs were written when tapping "Join Run" put the player straight on
 * the roster. Since then the sticky CTA opens a "Join this run?" confirmation
 * (where the player also picks their reminders) and "You're in · Tap to leave"
 * opens "Leave this game?" (src/routes/games.$gameId.index.tsx). The specs kept
 * tapping the CTA once and waiting for the flipped label behind a dialog that
 * nobody confirmed, so no row was ever written and nothing could propagate.
 *
 * The realtime specs are about what happens after the write, not about the
 * confirmation or the "Before you join" risk gate, so these helpers go through
 * both exactly as a player would and then wait for the page to show the result.
 * Call `stubRiskAcknowledged` (./risk-ack) on the joining page before it loads,
 * so the risk gate does not depend on whether this account has acknowledged `g1`
 * in the backend the run targets.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** Sticky CTA once the viewer is on the roster of a free run. */
export function joinedCta(page: Page): Locator {
  return page.getByRole("button", { name: /you're in · tap to leave/i }).first();
}

/** Sticky CTA while the viewer can still join a free run ("Join Run · N spots left"). */
export function joinCta(page: Page): Locator {
  return page.getByRole("button", { name: /^join run · /i }).first();
}

/** Tap "Join Run", confirm "Join this run?", and wait until the CTA reads "You're in". */
export async function joinFreeRun(page: Page): Promise<void> {
  const cta = joinCta(page);
  await expect(cta).toBeVisible({ timeout: 15_000 });
  await cta.click();

  const confirm = page.getByRole("alertdialog", { name: /join this run\?/i });
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  await confirm.getByRole("button", { name: /^join run$/i }).click();
  await expect(confirm).toBeHidden({ timeout: 5_000 });

  await expect(joinedCta(page)).toBeVisible({ timeout: 10_000 });
}

/** Tap "You're in · Tap to leave", confirm "Leave this game?", and wait for "Join Run". */
export async function leaveFreeRun(page: Page): Promise<void> {
  const cta = joinedCta(page);
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  const confirm = page.getByRole("alertdialog", { name: /leave this game\?/i });
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  // "Leave anyway" when inside the late-cancel window, "Leave game" otherwise.
  await confirm.getByRole("button", { name: /^leave (game|anyway)$/i }).click();
  await expect(confirm).toBeHidden({ timeout: 5_000 });

  await expect(joinCta(page)).toBeVisible({ timeout: 10_000 });
}

/**
 * Leave first if a previous run (or the other device) left this account on the
 * roster, so the join under test writes a real INSERT.
 */
export async function ensureNotJoined(page: Page): Promise<void> {
  // Wait for the CTA to settle into one of its two states before deciding.
  await expect(joinCta(page).or(joinedCta(page))).toBeVisible({ timeout: 15_000 });
  if (await joinedCta(page).isVisible()) await leaveFreeRun(page);
}
