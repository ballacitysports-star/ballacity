const REQUEST_ABORT_NAMES = new Set(["AbortError"]);
const REQUEST_ABORT_CODES = new Set(["ABORT_ERR", "ECONNRESET"]);
const REQUEST_ABORT_MESSAGES = new Set(["aborted", "this operation was aborted"]);

/**
 * Detects expected request cancellation from both Web AbortController and
 * Node's HTTP socket-close path. A visitor navigating away can surface either
 * shape, sometimes nested under `cause`.
 */
export function isRequestAbort(error: unknown): boolean {
  let current = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return false;

    const candidate = current as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };

    if (typeof candidate.name === "string" && REQUEST_ABORT_NAMES.has(candidate.name)) {
      return true;
    }
    if (typeof candidate.code === "string" && REQUEST_ABORT_CODES.has(candidate.code)) {
      return true;
    }
    if (
      typeof candidate.message === "string" &&
      REQUEST_ABORT_MESSAGES.has(candidate.message.trim().toLowerCase())
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}