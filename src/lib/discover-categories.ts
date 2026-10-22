/** Top-level categories on the Discover feed (`/feed?cat=`). */
export const DISCOVER_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "runs", label: "Pickup Runs" },
  { id: "teams", label: "Teams & Tryouts" },
  { id: "gyms", label: "Venues" },
  { id: "trainers", label: "Trainers" },
] as const;

export type DiscoverCategory = (typeof DISCOVER_CATEGORIES)[number]["id"];

export function isDiscoverCategory(v: unknown): v is DiscoverCategory {
  return DISCOVER_CATEGORIES.some((c) => c.id === v);
}
