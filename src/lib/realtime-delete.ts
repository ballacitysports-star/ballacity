/**
 * Supabase Realtime cannot filter DELETE events: the old row carries only its
 * primary key, so a `postgres_changes` subscription with `filter: ...` never
 * receives them. Listen to DELETE with no filter instead, and use this to skip
 * the ones that name a different parent. When the old row names nothing (the
 * usual case, since tables are not REPLICA IDENTITY FULL) the delete may be ours,
 * so the caller re-reads the authoritative state.
 */
export function deleteIsForOther(
  payload: { old?: unknown },
  key: string,
  expected: string | undefined,
): boolean {
  const value = (payload.old as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" && value !== expected;
}
