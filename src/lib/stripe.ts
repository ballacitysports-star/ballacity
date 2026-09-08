import { loadStripe, Stripe } from "@stripe/stripe-js";

export type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

/**
 * The environment new rows land in when Stripe tells us nothing.
 *
 * It matches `DEFAULT 'sandbox'` on highlight_reels.environment and
 * subscriptions.environment, so a build with no payments token reads and
 * writes the same partition the database would have chosen on its own.
 */
export const DEFAULT_BILLING_ENVIRONMENT: StripeEnv = "sandbox";

/** True when this build has a usable publishable key. */
export function paymentsConfiguredFor(token: string | undefined): boolean {
  return token?.startsWith("pk_test_") === true || token?.startsWith("pk_live_") === true;
}

/**
 * Which `environment` partition this build belongs to — never throws.
 *
 * Rows are partitioned by Stripe environment so test-mode purchases stay out
 * of live data. That partitioning still has to work on a build with no Stripe
 * key at all, because the free tier does not involve Stripe: a member's three
 * free reels must be readable and writable whether or not checkout is set up.
 * Use this for every query and insert; use getStripeEnvironment() only when a
 * charge is genuinely about to happen.
 */
export function billingEnvironmentFor(token: string | undefined): StripeEnv {
  if (token?.startsWith("pk_live_")) return "live";
  return DEFAULT_BILLING_ENVIRONMENT;
}

export function isPaymentsConfigured(): boolean {
  return paymentsConfiguredFor(clientToken);
}

export function getBillingEnvironment(): StripeEnv {
  return billingEnvironmentFor(clientToken);
}

function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Stripe payments are not configured for this build. Complete Stripe go-live in your Lovable project to enable production checkout.",
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(clientToken as string);
  }
  return stripePromise;
}

/**
 * The environment to bill in. Throws when payments are not configured, so only
 * call it on a path that is about to open checkout or the billing portal.
 */
export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}
