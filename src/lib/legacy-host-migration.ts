import { listUnclaimedHostedGames, claimHostedGame } from "@/lib/hosted-games-store";
import { getGamePaymentSettings, upsertGamePaymentSettings } from "@/lib/payments";
const RUN_KEY = "openrun.legacyHostMigration.v1";
let inFlight: Promise<MigrationResult> | null = null;

export type PlanAction = "claim-new-settings" | "claim-matching-settings" | "skip-other-host";

export interface PlanEntry {
  gameId: string;
  title: string;
  action: PlanAction;
  currentHostUserId: string | null;
  newHostUserId: string | null;
  currentSettingsHostId: string | null;
  newSettingsHostId: string | null;
}

export interface MigrationResult {
  claimed: number;
  scanned: number;
  plan: PlanEntry[];
  dryRun: boolean;
}

/**
 * One-shot per signed-in user: for every locally-hosted game with no hostUserId
 * and no DB game_payment_settings row, stamp local hostUserId AND create the
 * settings row with host_id = userId. After this runs, the legacyLocalHost
 * fallback can never grant host controls.
 *
 * If a settings row already exists with a different host_id, the local game is
 * left unstamped so we never steal ownership from the original DB host.
 *
 * Pass `{ dryRun: true }` to return a per-game plan WITHOUT writing anything.
 */
export async function runLegacyHostMigration(
  userId: string,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const empty: MigrationResult = { claimed: 0, scanned: 0, plan: [], dryRun: !!opts.dryRun };
  if (!userId || typeof window === "undefined") return empty;
  const key = `${RUN_KEY}:${userId}`;
  if (!opts.dryRun && !opts.force && window.localStorage.getItem(key) === "1") return empty;
  if (inFlight && !opts.force && !opts.dryRun) {
    await inFlight;
    return empty;
  }

  const run = (async (): Promise<MigrationResult> => {
    let claimed = 0;
    let scanned = 0;
    const plan: PlanEntry[] = [];
    try {
      const unclaimed = listUnclaimedHostedGames();
      for (const game of unclaimed) {
        scanned++;
        try {
          const existing = await getGamePaymentSettings(game.id);
          const currentHostUserId = (game as any).hostUserId ?? null;
          if (existing) {
            if (existing.host_id === userId) {
              plan.push({
                gameId: game.id,
                title: game.title ?? game.id,
                action: "claim-matching-settings",
                currentHostUserId,
                newHostUserId: userId,
                currentSettingsHostId: existing.host_id,
                newSettingsHostId: existing.host_id,
              });
              if (!opts.dryRun) {
                claimHostedGame(game.id, userId);
                claimed++;
              } else {
                claimed++;
              }
            } else {
              plan.push({
                gameId: game.id,
                title: game.title ?? game.id,
                action: "skip-other-host",
                currentHostUserId,
                newHostUserId: currentHostUserId,
                currentSettingsHostId: existing.host_id,
                newSettingsHostId: existing.host_id,
              });
            }
            continue;
          }
          plan.push({
            gameId: game.id,
            title: game.title ?? game.id,
            action: "claim-new-settings",
            currentHostUserId,
            newHostUserId: userId,
            currentSettingsHostId: null,
            newSettingsHostId: userId,
          });
          if (!opts.dryRun) {
            await upsertGamePaymentSettings({
              game_id: game.id,
              entry_fee: Number(game.price ?? 0),
              accepted_method_ids: [],
              requires_approval: false,
            });
            claimHostedGame(game.id, userId);
            claimed++;
          } else {
            claimed++;
          }
        } catch {
          // best-effort; skip and let the next session retry
        }
      }
      if (!opts.dryRun) window.localStorage.setItem(key, "1");
      return { claimed, scanned, plan, dryRun: !!opts.dryRun };
    } finally {
      if (!opts.dryRun) inFlight = null;
    }
  })();

  if (!opts.dryRun) inFlight = run;
  return run;
}
