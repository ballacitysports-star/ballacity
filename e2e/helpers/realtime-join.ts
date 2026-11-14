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

/**
 * Tap "You're in · Tap to leave", confirm "Leave this game?", and wait for "Join Run".
 *
 * Only a free cancellation is accepted. Inside g1's late-cancel window the
 * dialog offers "Leave anyway" instead, and confirming it would record a late
 * cancellation against the shared fixture player on every leave; global-setup
 * seeds g1 a day out so a run never gets there, and if one does, this fails
 * and says why rather than quietly recording one.
 */
export async function leaveFreeRun(page: Page): Promise<void> {
  const cta = joinedCta(page);
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  const confirm = page.getByRole("alertdialog", { name: /leave this game\?/i });
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  await expect(
    confirm.getByRole("button", { name: /^leave anyway$/i }),
    "g1 is inside its late-cancel window, so leaving would record a late cancellation " +
      "against the fixture player; global-setup should seed g1 further out",
  ).toHaveCount(0);
  await confirm.getByRole("button", { name: /^leave game$/i }).click();
  await expect(confirm).toBeHidden({ timeout: 5_000 });

  await expect(joinCta(page)).toBeVisible({ timeout: 10_000 });
}

/** The signed-in session the page holds (supabase-js keeps it in localStorage). */
async function pageSession(page: Page): Promise<{ accessToken: string; userId: string }> {
  const session = await page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      try {
        const v = JSON.parse(window.localStorage.getItem(key) ?? "null");
        if (v?.access_token && v?.user?.id) {
          return { accessToken: v.access_token as string, userId: v.user.id as string };
        }
      } catch {
        /* not a session */
      }
    }
    return null;
  });
  expect(session, "the page should hold a signed-in Supabase session").not.toBeNull();
  return session!;
}

/** Is this page's user on the game's roster, according to the database? */
async function onRosterInDb(page: Page, gameId: string): Promise<boolean> {
  const base = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  expect(base && key, "SUPABASE_URL and the publishable key are needed").toBeTruthy();
  const { accessToken, userId } = await pageSession(page);
  const res = await page.request.get(
    `${base}/rest/v1/game_participants?select=id&game_id=eq.${encodeURIComponent(gameId)}` +
      `&user_id=eq.${userId}`,
    { headers: { apikey: key!, authorization: `Bearer ${accessToken}` } },
  );
  expect(res.ok(), `roster read failed: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as unknown[]).length > 0;
}

/**
 * Leave first if a previous run (or the other device) left this account on the
 * roster, so the join under test writes a real INSERT.
 *
 * Decided on the database's answer, not on the CTA: the page starts from the
 * saved joined list (which the specs clear) and shows "Join Run" until its
 * roster load comes back, so whichever label appeared first said nothing about
 * the roster. Once the database has answered, wait for the page to agree, and
 * after leaving wait for the row to really be gone, since the page flips its
 * label before its DELETE lands.
 */
export async function ensureNotJoined(page: Page, gameId = "g1"): Promise<void> {
  // The game page may still be loading (the first visit of a run compiles it).
  const settle = { timeout: 20_000 };
  if (await onRosterInDb(page, gameId)) {
    await expect(joinedCta(page), "the page should show this account on the roster").toBeVisible(
      settle,
    );
    await leaveFreeRun(page);
    await expect
      .poll(() => onRosterInDb(page, gameId), {
        timeout: 10_000,
        message: "the leave should remove this account's roster row",
      })
      .toBe(false);
  } else {
    await expect(joinCta(page)).toBeVisible(settle);
  }
}
