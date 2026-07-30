import {
  DEFAULT_FILTERS,
  type FeedFilterSnapshot,
  type FeedPrefs,
  type FeedView,
} from "@/lib/user-prefs-store";
import type { DistanceUnit } from "@/lib/measurement-system";
import { formatDistance } from "@/lib/distance";

/** The saveable part of the prefs: everything that narrows or orders results. */
export function filterSnapshot(p: FeedPrefs): FeedFilterSnapshot {
  return {
    preferredSports: [...p.preferredSports],
    maxDistanceMi: p.maxDistanceMi,
    distanceUnit: p.distanceUnit,
    sortBy: p.sortBy,
    moneyFilter: p.moneyFilter,
    mineFilter: p.mineFilter,
  };
}

function normalize(f: FeedFilterSnapshot) {
  return JSON.stringify({ ...f, preferredSports: [...f.preferredSports].sort() });
}

export function sameFilters(a: FeedFilterSnapshot, b: FeedFilterSnapshot): boolean {
  return normalize(a) === normalize(b);
}

export function isDefaultFilters(f: FeedFilterSnapshot): boolean {
  return sameFilters(f, DEFAULT_FILTERS);
}

/** How many result-narrowing filters are active (sort/unit don't narrow). */
export function countActiveFilters(f: FeedFilterSnapshot): number {
  return (
    (f.preferredSports.length > 0 ? 1 : 0) +
    (f.maxDistanceMi != null ? 1 : 0) +
    (f.moneyFilter !== "all" ? 1 : 0) +
    (f.mineFilter !== "all" ? 1 : 0)
  );
}

/** A readable default name for "save current as view", e.g. "Basketball · 10 mi · Soonest". */
export function suggestViewName(f: FeedFilterSnapshot, unit: DistanceUnit): string {
  const parts: string[] = [];
  if (f.preferredSports.length === 1) parts.push(f.preferredSports[0]);
  else if (f.preferredSports.length > 1) parts.push(`${f.preferredSports.length} sports`);
  if (f.maxDistanceMi != null) parts.push(formatDistance(f.maxDistanceMi, unit));
  if (f.moneyFilter === "free") parts.push("Free");
  if (f.moneyFilter === "paid") parts.push("Paid");
  if (f.mineFilter === "hosting") parts.push("Hosting");
  if (f.mineFilter === "joined") parts.push("Joined");
  parts.push(f.sortBy === "soonest" ? "Soonest" : "Nearest");
  return parts.join(" · ").slice(0, 40);
}

export function applyView(prefs: FeedPrefs, view: FeedView | null): FeedPrefs {
  const filters = view ? view.filters : DEFAULT_FILTERS;
  return { ...prefs, ...filters, activeViewId: view?.id ?? null };
}

export function makeViewId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** True when the live filters drifted away from the saved view they came from. */
export function viewIsEdited(prefs: FeedPrefs): boolean {
  if (!prefs.activeViewId) return false;
  const view = prefs.savedViews.find((v) => v.id === prefs.activeViewId);
  if (!view) return false;
  return !sameFilters(view.filters, filterSnapshot(prefs));
}
