import { cn } from "@/lib/utils";

/**
 * Named widths for the app's page shells.
 *
 * The geometry itself lives in the `page-shell*` utilities in styles.css so
 * that routes writing the class directly and routes using <PageContainer>
 * cannot drift apart. These names describe the kind of content rather than a
 * size, so the choice stays visible in review instead of buried in a class
 * list.
 */
export type PageWidth = "narrow" | "prose" | "content" | "feed" | "flush" | "default" | "full";

/**
 * `default` maps to the original `page-shell` (72rem), so the routes that
 * already used it are unaffected by the scale being introduced around it.
 */
const WIDTH_UTILITY: Record<PageWidth, string> = {
  // Forms, auth, onboarding, consent.
  narrow: "page-shell-narrow",
  // Long-form reading: legal documents, policies, guidelines.
  prose: "page-shell-prose",
  // Feeds, profiles, detail pages, settings — the bulk of the app.
  content: "page-shell-content",
  // A single-column media feed, edge to edge on a phone.
  feed: "page-shell-feed",
  // A content column whose children supply their own horizontal padding.
  flush: "page-shell-flush",
  // Dashboards, admin, anything genuinely multi-column.
  default: "page-shell",
  // Maps and other fill-the-viewport surfaces.
  full: "page-shell-full",
};

export function pageShellUtility(width: PageWidth): string {
  return WIDTH_UTILITY[width];
}

/**
 * The class list for a page container, for callers that cannot render an extra
 * element — a route that must own its own scroll container, say — but still
 * want exactly the same geometry.
 */
export function pageContainerClasses(width: PageWidth = "content", className?: string): string {
  return cn(WIDTH_UTILITY[width], className);
}

/** Space above the first element on a page. */
export const PAGE_PADDING_TOP = "pt-4 sm:pt-6";
