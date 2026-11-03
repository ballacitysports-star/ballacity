/**
 * App-only maintenance mode. Stored in the public `app_settings.maintenance`
 * row (superadmin write, public read). When on, regular visitors see a
 * maintenance screen on app pages, while public SEO pages (landing, guides,
 * cities, legal) and sign-in stay open, and staff keep full access.
 */
export const MAINTENANCE_SETTING_KEY = "maintenance";

export type MaintenanceConfig = { enabled: boolean; message: string };

export const DEFAULT_MAINTENANCE: MaintenanceConfig = { enabled: false, message: "" };

export function parseMaintenance(value: unknown): MaintenanceConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled === true,
    message: typeof raw.message === "string" ? raw.message.slice(0, 500) : "",
  };
}

const OPEN_EXACT = new Set([
  "/",
  "/auth",
  "/reset-password",
  "/privacy",
  "/terms",
  "/cookies",
  "/contact",
  "/safety",
  "/community-guidelines",
  "/payment-policy",
  "/ai-disclosure",
  "/reel-privacy",
  "/plans",
  "/pickup",
  "/sitemap.xml",
]);
const OPEN_PREFIXES = ["/guide", "/blog", "/cities", "/safety", "/admin", "/superadmin", "/staff"];

/** True when the path stays reachable for everyone during maintenance. */
export function isMaintenanceOpenPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (OPEN_EXACT.has(p)) return true;
  return OPEN_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/") || p.startsWith(pre + "_"));
}

/** Whether to show the maintenance screen. Staff are never blocked. */
export function shouldBlockForMaintenance(
  config: MaintenanceConfig,
  pathname: string,
  isStaff: boolean,
): boolean {
  if (!config.enabled || isStaff) return false;
  return !isMaintenanceOpenPath(pathname);
}
