/**
 * Server only. Files a server function's failure in app_error_events by the rule in
 * error-report-middleware.ts. The middleware calls it for every error that leaves a handler; a handler
 * that catches an error itself and answers with words instead (a bulk action that collects each item's
 * failure, say) calls it for what it caught, which the middleware never sees.
 *
 * It lives in a .server.ts module because it needs `@tanstack/react-start/server`, which must never be
 * reachable from code the browser loads: error-report-middleware.ts is loaded by src/start.ts on the
 * client too, so it imports this module only inside `.server()`.
 */
import { getRequest } from "@tanstack/react-start/server";
import { reportServerError } from "@/lib/error-report.server";
import { failureBehind } from "@/lib/error-report";
import { isReportableServerFnError } from "@/lib/error-report-middleware";

/** Reports what a server function threw, under `route`. Never throws. */
export async function reportServerFnError(error: unknown, route: string | null): Promise<void> {
  // What the handler replaced with words for the member, if it did (errorInsteadOf).
  const failure = failureBehind(error);
  if (!isReportableServerFnError(failure)) return;
  try {
    let request: Request | null = null;
    try {
      request = getRequest();
    } catch {
      request = null;
    }
    // Nobody is waiting for the answer any more: not a failure worth a row.
    if (!request?.signal.aborted) {
      await reportServerError(failure, request, "server_fn", { route });
    }
  } catch {
    // Reporting must never change what the caller gets back.
  }
}
