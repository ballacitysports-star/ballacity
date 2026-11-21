import { createServerFn } from "@tanstack/react-start";
import { merchShopOpen } from "./shop-gate";

/**
 * Whether /shop is reachable, read from the public monetization setting on the
 * server. If the setting cannot be read, loadMonetizationConfig falls back to the
 * shipped defaults, where the platform is free and the shop is closed.
 */
export const getMerchShopOpen = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { loadMonetizationConfig } = await import("./settings.server");
  return { open: merchShopOpen(await loadMonetizationConfig(supabaseAdmin)) };
});
