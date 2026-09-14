/**
 * Fee arithmetic for game payments.
 *
 * Two payment modes exist and they must never be confused:
 *
 * - `direct_host` — the player pays the host inside Venmo/Zelle/cash. ballaCity
 *   never touches the money and takes **nothing**. No fee may ever be added.
 * - `ballacity_processed` — reserved for the future. Only when ballaCity really
 *   processes the payment may a processing fee and platform fee apply, and the
 *   full breakdown must be shown before the member pays.
 *
 * The server recomputes every quote from config before charging; a total sent
 * by a browser is never trusted.
 */

import { DEFAULT_MONETIZATION_CONFIG, type MonetizationConfig } from "./config";

export const PAYMENT_MODES = ["direct_host", "ballacity_processed"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export function isPaymentMode(value: unknown): value is PaymentMode {
  return typeof value === "string" && (PAYMENT_MODES as readonly string[]).includes(value);
}

export type FeeQuote = {
  mode: PaymentMode;
  /** The host's asking price, in cents. */
  subtotalCents: number;
  processingFeeCents: number;
  platformFeeCents: number;
  /** What the player actually pays. */
  totalCents: number;
  /** What the host receives. */
  hostReceivesCents: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function quoteFees(
  input: { amountCents: number; mode: PaymentMode },
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
): FeeQuote {
  const subtotalCents = Math.max(0, Math.round(input.amountCents));

  if (input.mode === "direct_host" || subtotalCents === 0) {
    return {
      mode: input.mode,
      subtotalCents,
      processingFeeCents: 0,
      platformFeeCents: 0,
      totalCents: subtotalCents,
      hostReceivesCents: subtotalCents,
    };
  }

  const f = config.fees;
  const processingFeeCents =
    Math.round((subtotalCents * f.processingFeeBps) / 10_000) + f.processingFeeFixedCents;
  const platformFeeCents = clamp(
    Math.round((subtotalCents * f.platformFeeBps) / 10_000),
    f.minPlatformFeeCents,
    f.maxPlatformFeeCents,
  );

  return {
    mode: input.mode,
    subtotalCents,
    processingFeeCents,
    platformFeeCents,
    totalCents: subtotalCents + processingFeeCents + platformFeeCents,
    hostReceivesCents: subtotalCents,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Human-readable lines for a fee breakdown, in display order. */
export function feeBreakdownLines(quote: FeeQuote): { label: string; value: string }[] {
  const lines = [{ label: "Game fee", value: formatCents(quote.subtotalCents) }];
  if (quote.mode === "ballacity_processed") {
    lines.push({ label: "Processing fee", value: formatCents(quote.processingFeeCents) });
    lines.push({ label: "ballaCity fee", value: formatCents(quote.platformFeeCents) });
  }
  lines.push({ label: "Total", value: formatCents(quote.totalCents) });
  return lines;
}

export const DIRECT_HOST_MODE_NOTE =
  "You pay the host directly in their payment app. ballaCity adds no fees and never holds the money.";
