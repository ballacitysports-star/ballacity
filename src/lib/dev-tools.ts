import { notFound } from "@tanstack/react-router";

/**
 * Developer tools (the route doctor, the share-card preview) exist for development builds
 * only: `vite dev`, which is also what Lovable's live preview runs. A production build,
 * including the published site, answers their URLs with the ordinary 404.
 */
export function devToolsEnabled(): boolean {
  return import.meta.env.DEV === true;
}

/** `beforeLoad` for a developer-only route: a 404 outside development builds. */
export function requireDevTools(): void {
  if (!devToolsEnabled()) throw notFound();
}
