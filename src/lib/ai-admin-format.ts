/** Display helpers for the AI control centre. */

/**
 * `est_cost_cents` is a numeric with real decimals, and current spend is a
 * fraction of a cent. Rounding that to `$0.01` would be a made-up number on a
 * page whose whole job is to show what is actually happening, so small amounts
 * keep their precision and only larger ones round to the usual two places.
 */
export function money(cents: number) {
  const dollars = cents / 100;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toPrecision(2)}`;
  return `$${dollars.toFixed(2)}`;
}

export function duration(ms: number | null | undefined) {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
