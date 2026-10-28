/**
 * A page left open across a deploy points at files that no longer exist. The
 * browser then reports a failed dynamic import in different words per engine;
 * retrying cannot fix it (the failed import is remembered), only a full reload.
 * An aborted request (a preload cancelled by navigating away) is not one.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    (error as { message?: string } | null | undefined)?.message ??
    (typeof error === "string" ? error : "");
  if (!message || /abort/i.test(message)) return false;
  return (
    /Importing a module script failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Loading (?:CSS )?chunk [\w-]+ failed/i.test(message)
  );
}
