import { useEffect, useState } from "react";
import { getPayPalCheckoutConfig } from "@/lib/paypal.functions";

export type PayPalCheckoutConfig = { clientId: string; merchantId: string };

type FetchConfig = (
  gameId: string,
) => Promise<{ clientId: string | null; merchantId: string | null }>;

const fetchFromServer: FetchConfig = (gameId) => getPayPalCheckoutConfig({ data: { gameId } });

/** How long the lookup may take before the pay screen stops waiting for it. */
export const PAYPAL_CONFIG_DEADLINE_MS = 6000;

export type PayPalCheckoutConfigState = {
  /** The PayPal button's config, or null when PayPal is not set up, failed, or has not answered yet. */
  config: PayPalCheckoutConfig | null;
  /** True once the lookup answered, failed or ran past its deadline. */
  settled: boolean;
};

/**
 * The PayPal button's public config for a game's pay screen.
 *
 * It loads beside the screen's own reads and has its own deadline. The pay page
 * used to await it, with no deadline, before leaving its loading state, so a
 * slow answer from the server held the whole screen on "Loading payment
 * options…". It must still not be treated as "no PayPal" before it settles: for
 * a host who only takes PayPal, that would tell the player the host hasn't set
 * up payment and to arrange it directly. So the page waits on `settled` only
 * when there is nothing else to show. A late answer after the deadline still
 * shows the PayPal button.
 *
 * `retryKey` re-runs the lookup (the screen's Retry button).
 */
export function usePayPalCheckoutConfig(
  gameId: string | undefined,
  fetchConfig: FetchConfig = fetchFromServer,
  retryKey: number = 0,
  deadlineMs: number = PAYPAL_CONFIG_DEADLINE_MS,
): PayPalCheckoutConfigState {
  const [config, setConfig] = useState<PayPalCheckoutConfig | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setConfig(null);
    setSettled(!gameId);
    if (!gameId) return;
    let cancelled = false;
    const deadline = setTimeout(() => {
      if (!cancelled) setSettled(true);
    }, deadlineMs);
    fetchConfig(gameId)
      .then((cfg) => {
        if (!cancelled && cfg.clientId && cfg.merchantId) {
          setConfig({ clientId: cfg.clientId, merchantId: cfg.merchantId });
        }
      })
      .catch(() => {
        /* PayPal not configured — one-tap buttons remain */
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(deadline);
    };
    // fetchConfig is a dependency in name only: callers pass a stable function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, retryKey, deadlineMs]);

  return { config, settled };
}

/**
 * What the pay screen shows once its own reads are done: the payment options, the "host hasn't set up payment"
 * empty state, or still "Loading payment options…". With no other method to offer it waits for PayPal to settle,
 * so a PayPal-only host's players are never told to arrange payment directly just because PayPal was slow.
 */
export function payOptionsView(input: {
  hasOtherMethods: boolean;
  paypal: PayPalCheckoutConfigState;
}): "options" | "empty" | "loading" {
  if (input.hasOtherMethods || input.paypal.config) return "options";
  return input.paypal.settled ? "empty" : "loading";
}
