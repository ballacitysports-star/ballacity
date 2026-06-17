import { migrateLegacyHostOwnership, getHostedGame } from "@/lib/hosted-games-store";
import { getGamePaymentSettings, upsertGamePaymentSettings } from "@/lib/payments";

const RUN_KEY = "openrun.legacyHostMigration.v1";
let inFlight: Promise<void> | null = null;

/**
 * One-shot per signed-in user: stamps any locally-hosted games with hostUserId
 * and ensures a game_payment_settings row exists with host_id = userId.
 * After this runs, the legacyLocalHost fallback can never grant host controls.
 */
export async function runLegacyHostMigration(userId: string): Promise<void> {
  if (!userId || typeof window === "undefined") return;
  const key = `${RUN_KEY}:${userId}`;
  if (window.localStorage.getItem(key) === "1") return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const migratedIds = migrateLegacyHostOwnership(userId);
      for (const id of migratedIds) {
        const game = getHostedGame(id);
        if (!game) continue;
        try {
          const existing = await getGamePaymentSettings(id);
          // If a settings row already exists for this game (regardless of host),
          // don't overwrite — that would risk stealing ownership.
          if (existing) continue;
          await upsertGamePaymentSettings({
            game_id: id,
            entry_fee: Number(game.price ?? 0),
            accepted_method_ids: [],
            requires_approval: false,
          });
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
