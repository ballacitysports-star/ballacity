/** A single conversation (`/messages/<id>`), not the inbox list (`/messages`). */
export function isChatThreadPath(pathname: string): boolean {
  return /^\/messages\/[^/]+\/?$/.test(pathname);
}
