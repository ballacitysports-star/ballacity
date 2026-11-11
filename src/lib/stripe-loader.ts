import type { Stripe } from "@stripe/stripe-js";
import { getStripeEnvironment } from "@/lib/stripe";

/**
 * Stripe.js, loaded only when checkout actually opens.
 *
 * @stripe/stripe-js's main entry injects https://js.stripe.com as soon as the module is imported, whether or not
 * loadStripe() is ever called (dist/index.mjs queues it on load). Imported from src/lib/stripe.ts, that put Stripe's
 * script on Reels, /plans and every page using the subscription hooks, for every viewer and minors included, while
 * payments are free. The /pure entry injects nothing until loadStripe() runs, and it is imported here only on demand.
 */
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    getStripeEnvironment(); // throws when this build has no publishable key
    stripePromise = import("@stripe/stripe-js/pure")
      .then(({ loadStripe }) => loadStripe(import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string))
      .catch((error: unknown) => {
        // A failed load (offline, blocked) is not cached, so opening checkout again retries.
        stripePromise = null;
        throw error;
      });
  }
  return stripePromise;
}
