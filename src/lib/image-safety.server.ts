/**
 * Server-only automated safety scan for uploaded imagery.
 * Loaded inside server-fn handlers.
 *
 * Uses the shared AI provider's `moderateImage` (one classifier prompt for
 * photos and reel frames alike) and records usage under `image_moderation`.
 */

import type { AiProvider } from "@/lib/ai/provider";
import type { AiConfig } from "@/lib/ai/config";

export type SafetyVerdict = {
  safe: boolean;
  label: string;
  reason: string | null;
  categories: string[];
  scanned: boolean;
  /** Suspected child sexual abuse material: the caller must escalate. */
  csam: boolean;
};

const UNSCANNED: SafetyVerdict = {
  safe: true,
  label: "unscanned",
  reason: null,
  categories: [],
  scanned: false,
  csam: false,
};

export type ImageSafetyDeps = {
  admin: any;
  config: AiConfig;
  provider: AiProvider;
};

async function defaultDeps(): Promise<ImageSafetyDeps> {
  const { loadAiConfig } = await import("@/lib/ai/settings.server");
  const { createLovableGatewayProvider } = await import("@/lib/ai/gateway.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const config = await loadAiConfig(supabaseAdmin);
  return { admin: supabaseAdmin, config, provider: createLovableGatewayProvider(config.provider) };
}

/**
 * Classify an image. Never throws: on any failure the verdict is
 * "scanned: false" so the caller can decide (we let the upload through and
 * leave it in the pending review queue).
 */
export async function scanImageForSafety(
  imageUrl: string,
  ref: { userId: string },
  deps?: ImageSafetyDeps,
): Promise<SafetyVerdict> {
  let resolved: ImageSafetyDeps;
  try {
    resolved = deps ?? (await defaultDeps());
  } catch {
    return UNSCANNED;
  }
  const { admin, config, provider } = resolved;
  // Not gated on the kill switch — safety scanning stays on when AI is off.
  if (!config.features.features.image_moderation.enabled) return UNSCANNED;

  const { recordUsage } = await import("@/lib/ai/usage.server");
  const { isCsamCategory } = await import("@/lib/ai/moderation.server");
  const usageRef = { jobId: null, userId: ref.userId, feature: "image_moderation" as const };

  try {
    const verdict = await provider.moderateImage({ imageUrl });
    const csam = isCsamCategory([verdict.label, ...verdict.categories]);
    const safe = verdict.safe && !csam;
    await recordUsage(admin, usageRef, {
      provider: provider.name,
      model: verdict.model,
      usage: verdict.usage,
      outcome: safe ? "ok" : "blocked",
      config,
    });
    return {
      safe,
      label: verdict.label,
      reason: verdict.reason,
      categories: verdict.categories,
      scanned: true,
      csam,
    };
  } catch {
    await recordUsage(admin, usageRef, {
      provider: config.provider.provider,
      model: config.provider.moderationImageModel,
      outcome: "error",
      config,
    });
    return UNSCANNED;
  }
}
