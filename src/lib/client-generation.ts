/**
 * Minimum supported client generation. A server-side flag in the public `app_settings.client_min_generation` row
 * (`{"min": <n>, "message": "..."}`, superadmin write, public read, the same pattern as `maintenance`) that every
 * build polls. A build whose CLIENT_DATA_GENERATION is below `min` reloads once to fetch the current bundle (no
 * service worker caches the app shell: public/OneSignalSDKWorker.js passes navigations to the network), and if it
 * is still below after that reload it asks the person to refresh instead of sending queries the database refuses.
 *
 * Raise CLIENT_DATA_GENERATION when a build stops depending on something the database is about to close, and raise
 * the flag only after that build has been live for the adoption window (docs/privacy/sec5-public-organizer-ref.md,
 * "Phase 2 rollout").
 *
 *   5: SEC-5. Organizer columns are read only through hosted_games_public / join_requests_visible /
 *      game_payment_settings_visible; no select=*, host_id filter, RETURNING * or upsert on the closed columns.
 *
 * Builds older than this gate (staging/priv-rehearsal-r4 and earlier) do not read the flag, so it cannot retire them;
 * for those the adoption window and the request measurement in the rollout plan are the gate.
 */
export const CLIENT_DATA_GENERATION = 5;
export const CLIENT_GENERATION_SETTING_KEY = "client_min_generation";
export const CLIENT_GENERATION_RELOAD_KEY = "ballacity.clientGenerationReload";
/** At most one automatic reload per this interval, so a flag set ahead of a deploy cannot loop. */
export const CLIENT_GENERATION_RELOAD_INTERVAL_MS = 10 * 60_000;

export type ClientGenerationConfig = { min: number; message: string };
export const DEFAULT_CLIENT_GENERATION: ClientGenerationConfig = { min: 0, message: "" };

export function parseClientGeneration(value: unknown): ClientGenerationConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const min =
    typeof raw.min === "number" && Number.isFinite(raw.min) ? Math.max(0, Math.floor(raw.min)) : 0;
  return { min, message: typeof raw.message === "string" ? raw.message.slice(0, 500) : "" };
}

export function isClientOutdated(
  config: ClientGenerationConfig,
  own: number = CLIENT_DATA_GENERATION,
): boolean {
  return own < config.min;
}

/** Whether an automatic reload is allowed now, given when the last one happened (ms epoch, or null). */
export function mayAutoReload(lastReloadAt: number | null, now: number): boolean {
  return (
    !lastReloadAt ||
    now - lastReloadAt >= CLIENT_GENERATION_RELOAD_INTERVAL_MS ||
    lastReloadAt > now
  );
}
