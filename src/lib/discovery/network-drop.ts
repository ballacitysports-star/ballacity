/**
 * Browsers report a request whose connection died (a server that took too long,
 * a dropped signal) as a bare TypeError: "Load failed" (Safari), "Failed to fetch"
 * (Chrome), "NetworkError when attempting to fetch resource" (Firefox). The run
 * is saved after each step, so these are worth trying again; a real answer from
 * the server (even an error) is not.
 */
export function isNetworkDrop(message: string | null | undefined): boolean {
  return /load failed|failed to fetch|networkerror|network request failed|network connection was lost|connection (?:was )?(?:reset|closed|lost)/i.test(
    message ?? "",
  );
}

/** How many dropped steps in a row the tab retries before it stops and says so. */
export const MAX_DROPPED_STEPS = 3;
