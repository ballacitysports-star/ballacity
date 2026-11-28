/**
 * Timeframes on the admin location analytics page (src/routes/admin.location-analytics.tsx).
 * The purge (purge_diagnostics, migration 20261129120000, WP 5.9) deletes location_denial_events
 * older than 90 days, so a longer window would show only empty days past that point.
 */
export const LOCATION_DENIAL_RETENTION_DAYS = 90;

export const LOCATION_ANALYTICS_TIMEFRAMES = [7, 14, 30, 90] as const;

export const LOCATION_ANALYTICS_DEFAULT_DAYS = 30;

/** The number of days to chart for the picked timeframe, never past what the purge keeps. */
export function locationAnalyticsDays(days: string): number {
  const n = Number(days);
  const picked = Number.isFinite(n) && n > 0 ? n : LOCATION_ANALYTICS_DEFAULT_DAYS;
  return Math.min(picked, LOCATION_DENIAL_RETENTION_DAYS);
}
