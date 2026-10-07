import type { Game } from "@/lib/sample-data";

/** A run flagged as needing players that still has a spot to give. */
export function needsPlayers(g: Pick<Game, "urgent" | "joined" | "maxPlayers">): boolean {
  return !!g.urgent && g.joined < g.maxPlayers;
}

/**
 * Sort comparator that floats runs needing players to the top. It returns 0
 * for two runs in the same group, so a stable sort keeps their existing order
 * (soonest or nearest) within the group.
 */
export function urgentFirst(
  a: Pick<Game, "urgent" | "joined" | "maxPlayers">,
  b: Pick<Game, "urgent" | "joined" | "maxPlayers">,
): number {
  return Number(needsPlayers(b)) - Number(needsPlayers(a));
}
