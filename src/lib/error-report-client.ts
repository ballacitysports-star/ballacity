/**
 * P0-8: sends browser errors to our own table. At most MAX_PER_PAGE reports per page load and
 * one per distinct error; failures to send are ignored. Nothing personal is sent: the message
 * is scrubbed here and again on the server, the route is a path with ids masked.
 */
import { buildErrorReport, isIgnorableError, type ErrorKind } from "@/lib/error-report";

export const MAX_PER_PAGE = 10;
const sent = new Set<string>();
let count = 0;
let installed = false;

type Sender = (report: {
  kind: "boundary" | "window" | "rejection";
  message: string;
  route: string | null;
  release: string | null;
  signedIn: boolean;
}) => Promise<unknown>;

let senderPromise: Promise<Sender> | null = null;
function defaultSender(): Promise<Sender> {
  senderPromise ??= import("@/lib/error-report.functions").then(
    (m) => (r) => m.reportClientError({ data: r }),
  );
  return senderPromise;
}

function signedInNow(): boolean {
  try {
    return Object.keys(globalThis.localStorage ?? {}).some((k) => /^sb-.*-auth-token$/.test(k));
  } catch {
    return false;
  }
}

/** Report one error from the browser. Never throws. */
export function reportBrowserError(
  error: unknown,
  kind: Extract<ErrorKind, "boundary" | "window" | "rejection">,
  send: () => Promise<Sender> = defaultSender,
): boolean {
  try {
    if (typeof window === "undefined" || isIgnorableError(error)) return false;
    const report = buildErrorReport({
      source: "client",
      kind,
      error,
      route: window.location?.pathname ?? null,
      signedIn: signedInNow(),
    });
    if (sent.has(report.fingerprint) || count >= MAX_PER_PAGE) return false;
    sent.add(report.fingerprint);
    count += 1;
    void send()
      .then((s) =>
        s({
          kind,
          message: report.message,
          route: report.route,
          release: report.release,
          signedIn: report.signedIn,
        }),
      )
      .catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Listen for uncaught errors and unhandled rejections in the browser, once. */
export function installBrowserErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => reportBrowserError(e.error ?? e.message, "window"));
  window.addEventListener("unhandledrejection", (e) => reportBrowserError(e.reason, "rejection"));
}

/** Test helper: forget what was sent. */
export function resetBrowserErrorReporting(): void {
  sent.clear();
  count = 0;
}
