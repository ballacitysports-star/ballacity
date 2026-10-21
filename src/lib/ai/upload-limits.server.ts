/**
 * Resolves a member's clip limits from their AI tier and the live `ai_limits`
 * row. Uses the same tier resolution as the AI gate, so the cap on an upload is
 * the cap the reel pipeline would apply.
 */

import { resolveAiTier } from "./gate.server";
import { loadAiConfig } from "./settings.server";
import { clipLimitsFor, type ClipLimits } from "./upload-limits";

export async function loadClipLimits(
  admin: Parameters<typeof loadAiConfig>[0],
  userId: string,
): Promise<ClipLimits> {
  const [config, tier] = await Promise.all([loadAiConfig(admin), resolveAiTier(admin, userId)]);
  return clipLimitsFor(tier, config.limits[tier]);
}
