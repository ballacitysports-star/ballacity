// The GA4 measurement id baked into the client build (vite.config.ts defines VITE_GA_MEASUREMENT_ID from it).
//
// GOOGLE_ANALYTICS_MEASUREMENT_ID decides it:
//   - a measurement id: that id;
//   - "off" (or "none", "disabled"; any case): no id, so AnalyticsHost mounts nothing and the tag never loads;
//   - unset or empty: the fallback below, because the deploy build has been seen receiving no value at all.
//
// The deploy build may not receive the environment's secrets, so the reliable way to switch GA off is the committed
// line GOOGLE_ANALYTICS_MEASUREMENT_ID="off" in .env.production, which vite.config.ts seeds into every build (a
// non-empty value from the environment still wins). Either way it takes a new build and publish: a page already
// loaded keeps the tag until it reloads.

/** The GA4 property the published app reports to when nothing says otherwise (#209, 2026-10-28). */
export const GA_FALLBACK_MEASUREMENT_ID = "G-MEWLGXSWXC";

const OFF_VALUES = new Set(["off", "none", "disabled"]);

/** The measurement id for a build, or "" for no analytics at all. */
export function resolveGaMeasurementId(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return GA_FALLBACK_MEASUREMENT_ID;
  if (OFF_VALUES.has(value.toLowerCase())) return "";
  return value;
}
