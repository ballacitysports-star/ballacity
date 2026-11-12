import { useEffect, useState } from "react";
import { getPayPalCheckoutConfig } from "@/lib/paypal.functions";

export type PayPalCheckoutConfig = { clientId: string; merchantId: string };

type FetchConfig = (
  gameId: string,
) => Promise<{ clientId: string | null; merchantId: string | null }>;

const fetchFromServer: FetchConfig = (gameId) => getPayPalCheckoutConfig({ data: { gameId } });

/**
 * The PayPal button's public config for a game's pay screen, or null while it
 * loads, when PayPal is not set up, or when the lookup fails.
 *
 * It is optional, so it loads on its own and never holds the screen. The pay
 * page used to await it between the payment methods and the end of its
 * loading state, with no deadline: a slow answer from the server kept the whole
 * screen on "Loading payment options…" for as long as the request took.
 */
export function usePayPalCheckoutConfig(
  gameId: string | undefined,
  fetchConfig: FetchConfig = fetchFromServer,
): PayPalCheckoutConfig | null {
  const [config, setConfig] = useState<PayPalCheckoutConfig | null>(null);

  useEffect(() => {
    setConfig(null);
    if (!gameId) return;
    let cancelled = false;
    fetchConfig(gameId)
      .then((cfg) => {
        if (!cancelled && cfg.clientId && cfg.merchantId) {
          setConfig({ clientId: cfg.clientId, merchantId: cfg.merchantId });
        }
      })
      .catch(() => {
        /* PayPal not configured — one-tap buttons remain */
      });
    return () => {
      cancelled = true;
    };
    // fetchConfig is a dependency in name only: callers pass a stable function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  return config;
}
