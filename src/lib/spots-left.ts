/**
 * Discover bottom card spot math.
 *
 * `liveCount` comes from the `game_participants` realtime subscription
 * (`useLiveParticipantCount`). It is `undefined` until the first hydration
 * completes, so callers must fall back to the static snapshot (`joined`)
 * to avoid briefly showing `0 spots` on mount.
 *
 * Clamped to `[0, maxPlayers]` on both ends so a stale snapshot with
 * `joined > maxPlayers` (e.g. capacity lowered by the host after the
 * snapshot was taken) never produces a negative spots pill.
 */
export function computeSpotsLeft(
  maxPlayers: number,
  joined: number,
  liveCount: number | undefined,
): number {
  const effective = liveCount ?? joined;
  const joinedCount = Math.min(maxPlayers, effective);
  return Math.max(0, maxPlayers - joinedCount);
}
