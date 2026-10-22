/** The pages the strip sits above. Detail pages under them have their own header. */
export function showsDiscoverTabs(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path === "/players" || path === "/teams" || path === "/trainers";
}
