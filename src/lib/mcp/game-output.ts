import { coarsenRow, isYouthInclusiveGame } from "@/lib/youth-game-location";

type McpGameRow = {
  min_age?: number | null;
  max_age?: number | null;
  location?: string | null;
  neighborhood?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  host_id?: string | null;
};

/**
 * What an API tool may return about a game. A youth-inclusive game carries the coarse location, and no host id
 * unless the caller is the host (the id of a 16-17 year old host must not be handed out); age bounds are dropped
 * from the output once they have been applied. The caller's own row access still decides which games appear.
 */
export function shapeGameForApi<T extends McpGameRow>(row: T, viewerId: string | null) {
  const { min_age, max_age, ...rest } = row;
  const youth = isYouthInclusiveGame({ minAge: min_age ?? null, maxAge: max_age ?? null });
  const safe = coarsenRow({ ...rest, min_age, max_age }) as typeof rest & McpGameRow;
  delete (safe as McpGameRow).min_age;
  delete (safe as McpGameRow).max_age;
  if (youth && safe.host_id && safe.host_id !== viewerId) delete safe.host_id;
  return safe;
}
