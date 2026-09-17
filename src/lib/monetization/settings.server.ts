/**
 * Loads the admin-editable monetization config from `app_settings` with a short
 * in-process cache, so a burst of server calls doesn't re-read the same row.
 *
 * Any read failure falls back to the built-in defaults — and because the
 * shipped default is free (`access.platformFreeMode: true`), that failure mode
 * is *open*. A settings blip can never accidentally paywall someone.
 *
 * Takes the client as a parameter, exactly like `@/lib/ai/settings.server`, so
 * it can be called from a server function, a route handler or the AI gate
 * without importing a Supabase client itself.
 */

import {
  DEFAULT_MONETIZATION_CONFIG,
  parseMonetizationOverrides,
  resolveMonetizationConfig,
  type MonetizationConfig,
} from "./config";

export const MONETIZATION_SETTING_KEY = "monetization";

const CACHE_MS = 30_000;
let cached: { at: number; config: MonetizationConfig } | null = null;

/**
 * Drops the cache so an admin toggle takes effect immediately.
 *
 * Note this only clears the isolate that serves the call. On a multi-isolate
 * runtime other isolates still take up to CACHE_MS to notice a change.
 */
export function invalidateMonetizationConfigCache() {
  cached = null;
}

export async function loadMonetizationConfig(
  client: any,
  opts: { fresh?: boolean } = {},
): Promise<MonetizationConfig> {
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.config;

  try {
    const { data, error } = await client
      .from("app_settings")
      .select("value")
      .eq("key", MONETIZATION_SETTING_KEY)
      .maybeSingle();
    if (error) throw error;

    const config = resolveMonetizationConfig(
      parseMonetizationOverrides((data as { value: unknown } | null)?.value),
    );
    cached = { at: Date.now(), config };
    return config;
  } catch {
    return DEFAULT_MONETIZATION_CONFIG;
  }
}
