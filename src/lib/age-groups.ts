/**
 * Age groups a coach / trainer works with. Stored on `teams.age_groups`
 * (coach rows only) as a list of the ids below.
 */
export const AGE_GROUPS = [
  { id: "youth", label: "Youth (12 & under)" },
  { id: "teen", label: "Teens (13–17)" },
  { id: "adult", label: "Adults (18+)" },
] as const;

export type AgeGroupId = (typeof AGE_GROUPS)[number]["id"];

const IDS: ReadonlySet<string> = new Set(AGE_GROUPS.map((g) => g.id));

export function isAgeGroupId(v: unknown): v is AgeGroupId {
  return typeof v === "string" && IDS.has(v);
}

export function ageGroupLabel(id: string): string {
  return AGE_GROUPS.find((g) => g.id === id)?.label ?? id;
}

/** Drops unknown ids and duplicates, keeping the canonical display order. */
export function normalizeAgeGroups(v: unknown): AgeGroupId[] {
  if (!Array.isArray(v)) return [];
  const have = new Set(v.filter(isAgeGroupId));
  return AGE_GROUPS.map((g) => g.id).filter((id) => have.has(id));
}

/**
 * Whether a trainer works with `wanted`. An empty `wanted` matches everyone.
 * A trainer who hasn't listed any age groups is *not* matched by a specific
 * age filter: we don't claim someone coaches kids they never said they coach.
 */
export function matchesAgeGroup(
  trainerGroups: readonly string[] | null | undefined,
  wanted: AgeGroupId | "" | null | undefined,
): boolean {
  if (!wanted) return true;
  return (trainerGroups ?? []).includes(wanted);
}

/** Parses the `age` URL search param; anything unrecognised means "any". */
export function parseAgeGroup(v: unknown): AgeGroupId | "" {
  return isAgeGroupId(v) ? v : "";
}
