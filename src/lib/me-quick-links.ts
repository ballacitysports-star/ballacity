/**
 * P2-9: shortcuts on the Me tab to the two creator surfaces that were only reachable
 * from deep links: the hosting dashboard (/host, hosted games, unpaid players,
 * reminders) and the Reel Studio (/reels). Each shows only when the member may use
 * it, so nobody is sent to a page that just says no.
 *
 * WP 4.1: "My availability" (posts, game invitations and requests, on /availability) comes first. It is hidden in
 * parent mode, like the Home card: a guardian acting for a child uses the family screens.
 */
export type MeQuickLink = { to: "/availability" | "/host" | "/reels"; label: string };

export function meQuickLinks(opts: {
  canHost: boolean;
  canUploadVideo: boolean;
  parentMode: boolean;
}): MeQuickLink[] {
  const links: MeQuickLink[] = [];
  if (!opts.parentMode) links.push({ to: "/availability", label: "My availability" });
  if (opts.canHost) links.push({ to: "/host", label: "Hosting" });
  // The Reels tab hides its "post a reel" entry in parent mode; the Me tab matches it.
  if (opts.canUploadVideo && !opts.parentMode) links.push({ to: "/reels", label: "Reel Studio" });
  return links;
}
