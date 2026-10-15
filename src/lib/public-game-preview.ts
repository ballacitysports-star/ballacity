/**
 * `/games/:id` (and only that exact shape) can be opened without signing in, to
 * show a minimal preview of an adult, public, upcoming game. Sub-pages such as
 * `/games/:id/pay` stay behind sign-in. What the preview may show is decided on
 * the server by `getPublicGameSeo`; this only says which URL gets the preview.
 */
export function isPublicGamePreviewPath(pathname: string): boolean {
  return /^\/games\/[^/]+\/?$/.test(pathname);
}

/** `/teams/:id` likewise; `/teams/create` is a real page, not a team. */
export function isPublicTeamPreviewPath(pathname: string): boolean {
  return /^\/teams\/[^/]+\/?$/.test(pathname) && !/^\/teams\/create\/?$/.test(pathname);
}
