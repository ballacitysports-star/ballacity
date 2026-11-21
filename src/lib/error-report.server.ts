/**
 * P0-8: saves error reports with the service role (server only). Saving never throws: a broken
 * reporter must not break the page or request it is reporting on.
 */
import type { ErrorReport, ErrorSource, ServerErrorKind } from "@/lib/error-report";

/**
 * At most this many reports per source per server instance per minute; the rest are dropped.
 * Browser reports (source "client", which reportClientError always files, whatever the caller
 * sends) and the server's own (source "server": ssr and server_fn) each have this budget, so browser
 * noise, or an anonymous caller sending reportClientError over and over, can never use up what a
 * failing server needs. Each source keeps the whole limit they used to share (so at most 120 rows a
 * minute in all) rather than a part of it: in a real outage both sides fail at once, and a split
 * would halve what either may file.
 */
export const REPORTS_PER_MINUTE = 60;
/** The longest a server error page waits for its report to be saved. */
export const REPORT_TIMEOUT_MS = 1500;
const budgets: Record<ErrorSource, { start: number; count: number }> = {
  client: { start: 0, count: 0 },
  server: { start: 0, count: 0 },
};

export function allowReport(source: ErrorSource, now = Date.now()): boolean {
  const budget = budgets[source];
  if (now - budget.start > 60_000) {
    budget.start = now;
    budget.count = 0;
  }
  budget.count += 1;
  return budget.count <= REPORTS_PER_MINUTE;
}

type Insertable = {
  from: (t: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function saveErrorReport(report: ErrorReport, admin?: Insertable): Promise<boolean> {
  try {
    if (!allowReport(report.source)) return false;
    const client =
      admin ??
      ((await import("@/integrations/supabase/client.server"))
        .supabaseAdmin as unknown as Insertable);
    const { error } = await client.from("app_error_events").insert({
      source: report.source,
      kind: report.kind,
      message: report.message,
      route: report.route,
      fingerprint: report.fingerprint,
      release: report.release,
      signed_in: report.signedIn,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Report a server-side failure. Never throws.
 *   * kind "ssr" (the default): a page that failed to render, from src/server.ts and the request
 *     middleware in src/start.ts;
 *   * kind "server_fn": a server function that failed, from src/lib/error-report-middleware.ts.
 * `opts.route` replaces the request path when that path says nothing useful (a server function's
 * RPC path is an opaque id). Without a request, the report has the route only and counts as signed out.
 */
export async function reportServerError(
  error: unknown,
  request: Request | null,
  kind: ServerErrorKind = "ssr",
  opts: { route?: string | null } = {},
): Promise<void> {
  try {
    const { buildErrorReport, isIgnorableError } = await import("@/lib/error-report");
    if (isIgnorableError(error)) return;
    let route: string | null = opts.route ?? null;
    if (route === null && request) {
      try {
        route = new URL(request.url).pathname;
      } catch {
        route = null;
      }
    }
    const signedIn =
      request !== null &&
      /sb-[^=]+-auth-token|authorization/i.test(
        `${request.headers.get("cookie") ?? ""} ${request.headers.has("authorization") ? "authorization" : ""}`,
      );
    // Never hold up the error page or response for long: give the save at most REPORT_TIMEOUT_MS.
    await Promise.race([
      saveErrorReport(buildErrorReport({ source: "server", kind, error, route, signedIn })),
      new Promise((resolve) => setTimeout(resolve, REPORT_TIMEOUT_MS)),
    ]);
  } catch {
    // never let reporting fail a request
  }
}
