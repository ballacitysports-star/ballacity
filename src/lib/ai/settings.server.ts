/**
 * Loads AI configuration from `app_settings` (non-secret values only) with a
 * short in-process cache so a burst of AI calls doesn't re-read four rows each
 * time. Any read failure falls back to the built-in defaults, so AI features
 * never break because a settings row is missing or malformed.
 */

import { DEFAULT_AI_CONFIG, parseAiConfig, type AiConfig } from "./config";

export const AI_SETTING_KEYS = ["ai_features", "ai_limits", "ai_provider", "ai_pricing"] as const;
export type AiSettingKey = (typeof AI_SETTING_KEYS)[number];

const CACHE_MS = 30_000;
let cached: { at: number; config: AiConfig } | null = null;

/** Drops the cache so an admin settings change takes effect immediately. */
export function invalidateAiConfigCache() {
  cached = null;
}

export async function loadAiConfig(admin: any, opts: { fresh?: boolean } = {}): Promise<AiConfig> {
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.config;

  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("key,value")
      .in("key", AI_SETTING_KEYS as unknown as string[]);
    if (error) throw error;

    const rows: Record<string, unknown> = {};
    for (const row of (data ?? []) as { key: string; value: unknown }[]) {
      rows[row.key] = row.value;
    }
    const config = parseAiConfig(rows);
    cached = { at: Date.now(), config };
    return config;
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}
