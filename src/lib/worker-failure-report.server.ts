/**
 * P2-7a: a scheduled worker that fails shows in the superadmin error view.
 *
 * pg_cron calls the worker endpoints through pg_net, and a job's "succeeded" only means the call was queued
 * (docs/scheduled-jobs-health.md). A worker answers 500 when its sweep fails, but that answer reached nobody: the
 * request middleware (src/start.ts) and src/server.ts report only what a handler throws or what h3 swallowed, never a
 * 500 the handler returns itself. So each worker route's POST handler is wrapped in reportingWorkerFailures, which
 * files every 5xx answer once in app_error_events through the server reporter (reportServerError):
 *   - the message is "<job>: <what failed>". <job> is the pg_cron job name. <what failed> is the `error` field of the
 *     route's JSON answer (`http_<status>` when it has none), or the message of what the handler threw. Nothing else of
 *     the answer (counts, results) and nothing of the request goes in. The reporter then removes emails, tokens, ids,
 *     long numbers and the values Postgres repeats in its errors, and cuts it to 500 characters;
 *   - the route is the endpoint's path, as given here; the kind is "ssr", the server's kind for a request that failed
 *     (app_error_events takes no other server kind), so the error view's server filter keeps it;
 *   - it counts as signed out: no request is passed to the reporter, so it reads no header, cookie or worker secret.
 * A handler that throws is reported here and answers a JSON 500 `{ "error": "worker_failed" }`, so the request
 * middleware never sees the throw and does not report it a second time (before, it answered the HTML error page). An
 * abort is rethrown unreported, as everywhere else. 2xx, 3xx and 4xx answers, the 401 for a wrong secret included, are
 * not reported. Reporting never throws and never changes the answer; it waits at most REPORT_TIMEOUT_MS (1.5 s), as a
 * server error page does, because a Worker's work after its answer is not guaranteed to run.
 */
import { reportServerError } from "@/lib/error-report.server";
import { errorMessageOf } from "@/lib/error-report";
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

/** Files one worker failure as "<job>: <what failed>" under the endpoint's path. Never throws. */
export async function reportWorkerFailure(worker: WorkerEndpoint, failure: unknown): Promise<void> {
  try {
    const what = typeof failure === "string" ? failure : errorMessageOf(failure);
    await reportServerError(`${worker.job}: ${what}`, null, "ssr", { route: worker.route });
  } catch {
    // Reporting must never change what the scheduler gets back.
  }
}

function workerFailedResponse(): Response {
  return new Response(JSON.stringify({ error: "worker_failed" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Wraps a worker route's handler: a 5xx it answers, or anything it throws (but an abort), is reported once with
 * reportWorkerFailure. The answer is the handler's own, unchanged; a throw answers a JSON 500.
 */
export function reportingWorkerFailures<C extends { request: Request }>(
  worker: WorkerEndpoint,
  handler: (ctx: C) => Response | Promise<Response>,
): (ctx: C) => Promise<Response> {
  return async (ctx) => {
    let response: Response;
    try {
      response = await handler(ctx);
    } catch (error) {
      if (ctx.request.signal.aborted || isRequestAbort(error)) throw error;
      console.error(`[${worker.job}] worker failed`, error);
      await reportWorkerFailure(worker, error);
      return workerFailedResponse();
    }
    if (response.status >= 500) await reportWorkerFailure(worker, await failureOf(response));
    return response;
  };
}
