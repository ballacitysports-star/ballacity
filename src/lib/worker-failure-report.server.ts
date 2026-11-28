/**
 * P2-7a: a scheduled worker that fails shows in the superadmin error view.
 *
 * pg_cron calls the worker endpoints through pg_net, and a job's "succeeded" only means the call was queued
 * (docs/scheduled-jobs-health.md). A worker answers 500 when its sweep fails, but that answer reached nobody: the
 * request middleware (src/start.ts) and src/server.ts report only what a handler throws or what h3 swallowed, never a
 * 500 the handler returns itself. So each worker route's POST handler is wrapped in reportingWorkerFailures, which
 * files its 5xx answers in app_error_events through the server reporter (reportServerError):
 *   - the message is "<job>: <what failed>". <job> is the pg_cron job name. <what failed> is the `error` field of the
 *     route's JSON answer (`http_<status>` when it has none), or the message of what the handler threw. Nothing else of
 *     the answer (counts, results) and nothing of the request goes in. The reporter then removes emails, tokens, ids,
 *     long numbers and the values Postgres repeats in its errors, and cuts it to 500 characters;
 *   - the route is the endpoint's path, as given here; the kind is "ssr", the server's kind for a request that failed
 *     (app_error_events takes no other server kind), so the error view's server filter keeps it;
 *   - it counts as signed out: no request is passed to the reporter, so it reads no header, cookie or worker secret;
 *   - the same failure is filed at most once every WORKER_REPORT_EVERY_MS (30 minutes). A worker that keeps failing
 *     runs every minute or every 5 minutes, and the error view reads only the newest 2,000 rows of its window: one row
 *     a run would push every other error out of it. "The same" is the fingerprint the error view groups by (the
 *     scrubbed message and the route), and the check reads app_error_events, so it holds across server instances. A
 *     row that was not saved (the per-minute budget was used up, the save failed) does not count, so the next failure
 *     tries again; a check that fails files the row anyway.
 * A handler that throws is reported here and answers a JSON 500 `{ "error": "worker_failed" }`, so the request
 * middleware never sees the throw and does not report it a second time (before, it answered the HTML error page). An
 * abort is rethrown unreported, as everywhere else. 2xx, 3xx and 4xx answers, the 401 for a wrong secret included, are
 * not reported. Reporting never throws and never changes the answer. A Worker's work after its answer is not
 * guaranteed to run, so the answer waits for the report, but at most WORKER_REPORT_WAIT_MS (1.5 s), and never past
 * WORKER_ANSWER_BY_MS (4 s) after the call arrived: pg_net stops waiting after 5 s, and an answer it no longer waits
 * for counts as "no response" instead of a 5xx. A run that already took that long answers at once; its report is
 * started but may not be saved.
 */
import { REPORT_TIMEOUT_MS, reportServerError } from "@/lib/error-report.server";
import { buildErrorReport, errorMessageOf } from "@/lib/error-report";
import { isRequestAbort } from "@/lib/request-abort";

/** A worker endpoint: the pg_cron job that calls it (its name leads the report) and its path. */
export type WorkerEndpoint = { job: string; route: string };

export const REMINDERS_WORKER: WorkerEndpoint = {
  job: "send-game-reminders",
  route: "/api/public/reminders/run",
};
export const NOTIFICATION_FLUSH_WORKER: WorkerEndpoint = {
  job: "flush-held-notifications",
  route: "/api/public/notifications/flush",
};
/** No pg_cron job calls this endpoint (the job of this name runs the same sweep in SQL); external schedulers do. */
export const RELEASE_HOLDS_WORKER: WorkerEndpoint = {
  job: "release-expired-payment-holds",
  route: "/api/public/payments/release-holds",
};
export const REELS_WORKER: WorkerEndpoint = {
  job: "process-highlight-reels",
  route: "/api/public/reels/process",
};

/** The same failure (same fingerprint and route) is filed at most once in this long. */
export const WORKER_REPORT_EVERY_MS = 30 * 60_000;
/** The longest a failed run's answer waits for its report, as long as a server error page waits. */
export const WORKER_REPORT_WAIT_MS = REPORT_TIMEOUT_MS;
/** A failed run answers by this long after the call arrived, report saved or not (pg_net waits 5 s). */
export const WORKER_ANSWER_BY_MS = 4_000;

/** What a 5xx answer says failed: its JSON `error` field when it is a non-empty string, else `http_<status>`. */
export async function failureOf(response: Response): Promise<string> {
  try {
    const parsed: unknown = JSON.parse(await response.clone().text());
    const error =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as { error?: unknown }).error
        : undefined;
    if (typeof error === "string" && error.trim()) return error;
  } catch {
    // Not JSON, or a body that cannot be read twice: the status is what is known.
  }
  return `http_${response.status}`;
}

// app_error_events is newer than the generated types; read it through a narrow typed view.
type RecentQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  eq: (col: string, v: string) => RecentQuery;
  gte: (col: string, v: string) => RecentQuery;
  limit: (n: number) => RecentQuery;
};
type RecentRows = { from: (t: "app_error_events") => { select: (c: string) => RecentQuery } };

/** Whether a row with this fingerprint and route was saved at or after `since`. A read that fails says no. */
async function filedSince(fingerprint: string, route: string, since: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as unknown as RecentRows)
      .from("app_error_events")
      .select("id")
      .eq("fingerprint", fingerprint)
      .eq("route", route)
      .gte("created_at", since)
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Files one worker failure as "<job>: <what failed>" under the endpoint's path, unless the same failure was filed in
 * the last WORKER_REPORT_EVERY_MS. Never throws.
 */
export async function reportWorkerFailure(worker: WorkerEndpoint, failure: unknown): Promise<void> {
  try {
    const what = typeof failure === "string" ? failure : errorMessageOf(failure);
    const message = `${worker.job}: ${what}`;
    // The fingerprint and route the reporter will save, so the check matches the row it would add.
    const { fingerprint, route } = buildErrorReport({
      source: "server",
      kind: "ssr",
      error: message,
      route: worker.route,
    });
    const since = new Date(Date.now() - WORKER_REPORT_EVERY_MS).toISOString();
    if (route !== null && (await filedSince(fingerprint, route, since))) return;
    await reportServerError(message, null, "ssr", { route: worker.route });
  } catch {
    // Reporting must never change what the scheduler gets back.
  }
}

/** Waits for `work`, but at most `ms` (not at all when `ms` is 0 or less). `work` never rejects. */
async function waitAtMost(work: Promise<void>, ms: number): Promise<void> {
  if (ms <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

function workerFailedResponse(): Response {
  return new Response(JSON.stringify({ error: "worker_failed" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Wraps a worker route's handler: a 5xx it answers, or anything it throws (but an abort), is reported with
 * reportWorkerFailure. The answer is the handler's own, unchanged; a throw answers a JSON 500.
 */
export function reportingWorkerFailures<C extends { request: Request }>(
  worker: WorkerEndpoint,
  handler: (ctx: C) => Response | Promise<Response>,
): (ctx: C) => Promise<Response> {
  return async (ctx) => {
    const arrived = Date.now();
    const report = (failure: unknown) =>
      waitAtMost(
        reportWorkerFailure(worker, failure),
        Math.min(WORKER_REPORT_WAIT_MS, WORKER_ANSWER_BY_MS - (Date.now() - arrived)),
      );
    let response: Response;
    try {
      response = await handler(ctx);
    } catch (error) {
      if (ctx.request.signal.aborted || isRequestAbort(error)) throw error;
      console.error(`[${worker.job}] worker failed`, error);
      await report(error);
      return workerFailedResponse();
    }
    if (response.status >= 500) await report(await failureOf(response));
    return response;
  };
}
