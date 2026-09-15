/**
 * Shared urgency level for roster "spots left" indicators.
 *
 * Consumed by `SpotsPill`, `GameCard`, and the game-detail / pay screens so
 * that low-availability styling is consistent across every surface a
 * player sees during the join flow.
 *
 * Buckets:
 *   - `full`     — 0 spots remaining (destructive styling).
 *   - `critical` — 1–3 spots remaining (coral + pulse). Also matches the
 *                  ≤3 threshold used by the existing GameCard "N left" tag.
 *   - `low`      — >3 remaining, but ≤20% of capacity (amber tint).
 *   - `normal`   — plenty of room (default lime).
 *
 * `maxPlayers` is optional so callers that don't know capacity (e.g. the
 * legacy `SpotsPill` call sites) can still get sensible `full`/`critical`
 * bucketing without a `low` bucket.
 */
export type SpotsUrgency = "full" | "critical" | "low" | "normal";

export function getSpotsUrgency(spotsLeft: number, maxPlayers?: number): SpotsUrgency {
  if (spotsLeft <= 0) return "full";
  if (spotsLeft <= 3) return "critical";
  if (typeof maxPlayers === "number" && maxPlayers > 0) {
    if (spotsLeft / maxPlayers <= 0.2) return "low";
  }
  return "normal";
}
