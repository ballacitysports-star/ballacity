import { createServerFn } from "@tanstack/react-start";

/**
 * Compatibility shim for older open browser tabs that may still call the prior
 * feed-preferences RPC. Current feed preference sync uses the browser database
 * client directly from `use-feed-prefs-sync` to avoid startup RPC races.
 */
export const getFeedPreferences = createServerFn({ method: "GET" }).handler(async () => null);

export const saveFeedPreferences = createServerFn({ method: "POST" })
  .inputValidator((input: { prefsJson: string }) => {
    if (typeof input?.prefsJson !== "string" || input.prefsJson.length > 100_000) {
      throw new Error("Invalid feed preferences payload");
    }
    return input;
  })
  .handler(async (): Promise<{ ok: boolean }> => ({ ok: false }));
