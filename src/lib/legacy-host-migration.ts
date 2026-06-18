import { listUnclaimedHostedGames, claimHostedGame } from "@/lib/hosted-games-store";
import { getGamePaymentSettings, upsertGamePaymentSettings } from "@/lib/payments";
const RUN_KEY = "openrun.legacyHostMigration.v1";
let inFlight: Promise<{ claimed: number; scanned: number }> | null = null;

/**
 * One-shot per signed-in user: for every locally-hosted game with no hostUserId
 * and no DB game_payment_settings row, stamp local hostUserId AND create the
 * settings row with host_id = userId. After this runs, the legacyLocalHost
 * fallback can never grant host controls.
 *
 * If a settings row already exists with a different host_id, the local game is
 * left unstamped so we never steal ownership from the original DB host.
 */
export async function runLegacyHostMigration(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<{ claimed: number; scanned: number }> {
  if (!userId || typeof window === "undefined") return { claimed: 0, scanned: 0 };
  const key = `${RUN_KEY}:${userId}`;
  if (!opts.force && window.localStorage.getItem(key) === "1") return { claimed: 0, scanned: 0 };
  if (inFlight && !opts.force) {
    await inFlight;
    return { claimed: 0, scanned: 0 };
  }

  inFlight = (async () => {
    let claimed = 0;
    let scanned = 0;
    try {
      const unclaimed = listUnclaimedHostedGames();
      for (const game of unclaimed) {
        scanned++;
        try {
          const existing = await getGamePaymentSettings(game.id);
          if (existing) {
            if (existing.host_id === userId) {
              claimHostedGame(game.id, userId);
              claimed++;
            }
            continue;
          }
          await upsertGamePaymentSettings({
            game_id: game.id,
            entry_fee: Number(game.price ?? 0),
            accepted_method_ids: [],
            requires_approval: false,
          });
          claimHostedGame(game.id, userId);
          claimed++;
        } catch {
          // best-effort; skip and let the next session retry
        }
      }
      window.localStorage.setItem(key, "1");
      return { claimed, scanned };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
