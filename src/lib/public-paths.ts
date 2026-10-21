/**
 * A single game's page (`/games/<id>`) opens for signed-out visitors, who get a
 * short public preview instead of the signed-in page. Its sub-pages (pay,
 * payment setup) have a further segment and stay behind sign-in.
 */
export function isPublicGamePath(pathname: string): boolean {
  return /^\/games\/[^/]+\/?$/.test(pathname);
}
