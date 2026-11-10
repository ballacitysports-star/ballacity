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

/**
 * Plain-language availability for cards: "10 spots open" / "1 spot open" /
 * "Full". `short` gives "10 open" for tight rows. Reads as a call to action
 * where a bare "0/10" reads like nothing is happening.
 */
export function spotsOpenLabel(spotsLeft: number, opts: { short?: boolean } = {}): string {
  if (spotsLeft <= 0) return "Full";
  if (opts.short) return `${spotsLeft} open`;
  return `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} open`;
}

/**
 * The pay page's "this game just filled up" warning. Only for a viewer still about to pay: the live count says the
 * game is full, and the viewer neither holds a place on it nor has a payment in (submitted, waiting for the host, or
 * verified). A player whose own payment just filled the last spot must not be told to hold off.
 */
export function showFilledUpWarning(opts: {
  /** The live count; undefined until it is known, and then there is no warning. */
  liveCount: number | undefined;
  spotsLeft: number;
  viewerHoldsPlace: boolean;
  hasSubmission: boolean;
}): boolean {
  return (
    opts.liveCount !== undefined &&
    opts.spotsLeft <= 0 &&
    !opts.viewerHoldsPlace &&
    !opts.hasSubmission
  );
}
