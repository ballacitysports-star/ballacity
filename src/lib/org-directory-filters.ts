import { parseHours, resolveOpenState } from "@/lib/org-hours";

/**
 * Quick-filter pills on the /orgs directory. Pills narrow the list together
 * (Open now + Indoor courts = open facilities with indoor courts); "All" is
 * simply no pill selected.
 */
export const DIRECTORY_FILTERS = [
  { id: "open", label: "Open now" },
  { id: "rentals", label: "Court rentals" },
  { id: "indoor", label: "Indoor courts" },
  { id: "outdoor", label: "Outdoor courts" },
] as const;

export type DirectoryFilterId = (typeof DIRECTORY_FILTERS)[number]["id"];

export function isDirectoryFilterId(v: unknown): v is DirectoryFilterId {
  return DIRECTORY_FILTERS.some((f) => f.id === v);
}

/** The pills as they are written in the URL: ids in their fixed order, comma-separated. */
export function serializeDirectoryFilters(selected: ReadonlySet<DirectoryFilterId>): string {
  return DIRECTORY_FILTERS.filter((f) => selected.has(f.id))
    .map((f) => f.id)
    .join(",");
}

/** Reads the pills back from the URL, ignoring anything that isn't a known id. */
export function parseDirectoryFilters(raw: string | undefined | null): Set<DirectoryFilterId> {
  const out = new Set<DirectoryFilterId>();
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim();
    if (isDirectoryFilterId(id)) out.add(id);
  }
  return out;
}

export type FilterableOrg = {
  category: string | null;
  amenities: string[] | null;
  hours: unknown;
  timezone: string | null;
};

const has = (org: FilterableOrg, amenity: string) => (org.amenities ?? []).includes(amenity);

/** A facility matches a pill by its category or by an amenity it lists. */
export function matchesDirectoryFilter(
  org: FilterableOrg,
  id: DirectoryFilterId,
  now: Date = new Date(),
): boolean {
  switch (id) {
    case "open":
      return resolveOpenState(parseHours(org.hours), org.timezone, now).status === "open";
    case "rentals":
      return /rental/i.test(org.category ?? "") || has(org, "Court rentals");
    case "indoor":
      return org.category === "Indoor courts" || has(org, "Indoor courts");
    case "outdoor":
      return org.category === "Outdoor courts" || has(org, "Outdoor courts");
  }
}

/** Facilities that satisfy every selected pill. No pills selected = everyone. */
export function applyDirectoryFilters<T extends FilterableOrg>(
  orgs: readonly T[],
  selected: ReadonlySet<DirectoryFilterId>,
  now: Date = new Date(),
): T[] {
  if (selected.size === 0) return [...orgs];
  return orgs.filter((o) => [...selected].every((id) => matchesDirectoryFilter(o, id, now)));
}
