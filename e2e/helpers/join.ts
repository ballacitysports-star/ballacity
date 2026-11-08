import { expect, type Page } from "@playwright/test";

/**
 * Answer the free-join confirmation the game page shows after "Join Run" is
 * tapped (src/routes/games.$gameId.index.tsx: `setConfirmAction("join")` →
 * AlertDialog "Join this run?" with a "Join Run" action).
 *
 * The join only happens once this is confirmed, so a spec that taps the CTA
 * and then waits for "You're in · Tap to leave" or a game_participants insert
 * must call this in between. Scoped to the dialog so it can never match the
 * page's own "Join Run" CTA behind it.
 */
export async function confirmFreeJoin(page: Page) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByRole("button", { name: /^join run$/i }).click();
}

/**
 * Answer the leave confirmation ("Leave this game?") that "You're in · Tap to
 * leave" opens. Its action reads "Leave game", or "Leave anyway" inside the
 * late-cancel window.
 */
export async function confirmLeave(page: Page) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByRole("button", { name: /^leave (game|anyway)$/i }).click();
}
