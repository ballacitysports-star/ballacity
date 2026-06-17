import { listUnclaimedHostedGames, claimHostedGame } from "@/lib/hosted-games-store";
import { getGamePaymentSettings, upsertGamePaymentSettings } from "@/lib/payments";

const RUN_KEY = "openrun.legacyHostMigration.v1";
let inFlight: Promise<void> | null = null;

/**
 * One-shot per signed-in user: for every locally-hosted game with no hostUserId
 * and no DB game_payment_settings row, stamp local hostUserId AND create the
 * settings row with host_id = userId. After this runs, the legacyLocalHost
 * fallback can never grant host controls.
 *
 * If a settings row already exists with a different host_id, the local game is
 * left unstamped so we never steal ownership from the original DB host.
 */
export async function runLegacyHostMigration(userId: string): Promise<void> {
  if (!userId || typeof window === "undefined") return;
  const key = `${RUN_KEY}:${userId}`;
  if (window.localStorage.getItem(key) === "1") return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const unclaimed = listUnclaimedHostedGames();
      for (const game of unclaimed) {
        try {
          const existing = await getGamePaymentSettings(game.id);
          if (existing) {
            // DB already records an owner. Only stamp locally if it matches.
            if (existing.host_id === userId) claimHostedGame(game.id, userId);
            continue;
          }
          await upsertGamePaymentSettings({
            game_id: game.id,
            entry_fee: Number(game.price ?? 0),
            accepted_method_ids: [],
            requires_approval: false,
          });
          claimHostedGame(game.id, userId);
        } catch {
          // best-effort; skip and let the next session retry
        }
      }
      window.localStorage.setItem(key, "1");
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
