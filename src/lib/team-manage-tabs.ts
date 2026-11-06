/**
 * The tabs of a team's Manage page (/teams/$teamId/manage?tab=…). The tab is in the
 * URL so the standalone invite and waiver pages can redirect straight to it (P2-8)
 * and a link can open a specific tab.
 */
export const MANAGE_TABS = [
  "dashboard",
  "roster",
  "rsvps",
  "invites",
  "waiver",
  "analytics",
  "settings",
] as const;

export type ManageTab = (typeof MANAGE_TABS)[number];

export const DEFAULT_MANAGE_TAB: ManageTab = "dashboard";

export function isManageTab(value: unknown): value is ManageTab {
  return (MANAGE_TABS as readonly unknown[]).includes(value);
}

/** Search params for the Manage route: an unknown or missing tab falls back to the default. */
export function validateManageSearch(search: Record<string, unknown>): { tab?: ManageTab } {
  return isManageTab(search.tab) && search.tab !== DEFAULT_MANAGE_TAB ? { tab: search.tab } : {};
}
