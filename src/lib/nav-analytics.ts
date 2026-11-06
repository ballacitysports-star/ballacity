// P1-9 evidence: which bottom-bar tabs people use, and how often they reach Create.
// Everything goes through trackEvent, so the analytics rules hold: adults only,
// allow-listed events, primitive non-personal parameters. Tab names are fixed
// words from TABS ("home", "discover", "reels", "inbox", "me"), never a path.
import { trackEvent } from "@/lib/analytics";
import { isFacilityEventKind } from "@/lib/facility-events";
import { TABS } from "@/lib/navigation-gestures";

export type TabVia = "tap" | "swipe";

/** The tab's fixed name for a tab destination, or null when `to` is not a tab. */
export function tabName(to: string): string | null {
  const tab = TABS.find((t) => t.to === to);
  return tab ? tab.label.toLowerCase() : null;
}

/** The fixed name of the tab that owns `pathname`, or "other" off the tab bar. */
export function tabNameForPath(pathname: string): string {
  const tab = TABS.find((t) => t.match(pathname));
  return tab ? tab.label.toLowerCase() : "other";
}

/** A bottom-bar tab was chosen by tapping it or swiping to it. */
export function trackTabSelect(to: string, via: TabVia, fromPathname: string): void {
  const tab = tabName(to);
  if (!tab) return;
  trackEvent("select_tab", { tab, via, from: tabNameForPath(fromPathname) });
}

/** The Create screen was opened. Only a known kind is sent; anything else is "other". */
export function trackOpenCreate(kind: unknown): void {
  trackEvent("open_create", {
    kind: isFacilityEventKind(kind) ? kind : "other",
  });
}
