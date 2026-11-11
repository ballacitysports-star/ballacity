/**
 * P0-8: saves error reports with the service role (server only). Saving never throws: a broken
 * reporter must not break the page or request it is reporting on.
 */
import type { ErrorReport } from "@/lib/error-report";

/** At most this many reports per server instance per minute; the rest are dropped. */
export const REPORTS_PER_MINUTE = 60;
/** The longest a server error page waits for its report to be saved. */
export const REPORT_TIMEOUT_MS = 1500;
let windowStart = 0;
let windowCount = 0;

export function allowReport(now = Date.now()): boolean {
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= REPORTS_PER_MINUTE;
}

type Insertable = {
  from: (t: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function saveErrorReport(report: ErrorReport, admin?: Insertable): Promise<boolean> {
  try {
    if (!allowReport()) return false;
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

/** For src/server.ts: report a server-side render failure. Never throws. */
export async function reportServerError(error: unknown, request: Request): Promise<void> {
  try {
    const { buildErrorReport, isIgnorableError } = await import("@/lib/error-report");
    if (isIgnorableError(error)) return;
    let route: string | null = null;
    try {
      route = new URL(request.url).pathname;
    } catch {
      route = null;
    }
    const signedIn = /sb-[^=]+-auth-token|authorization/i.test(
      `${request.headers.get("cookie") ?? ""} ${request.headers.has("authorization") ? "authorization" : ""}`,
    );
    // Never hold up the error page for long: give the save at most REPORT_TIMEOUT_MS.
    await Promise.race([
      saveErrorReport(buildErrorReport({ source: "server", kind: "ssr", error, route, signedIn })),
      new Promise((resolve) => setTimeout(resolve, REPORT_TIMEOUT_MS)),
    ]);
  } catch {
    // never let reporting fail a request
  }
}
