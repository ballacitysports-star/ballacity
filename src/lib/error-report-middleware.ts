/**
 * P0-8: reports server-function failures (kind "server_fn") to our own error table, then rethrows
 * the same error, so what the caller gets back never changes.
 *
 * It is a global function middleware (src/start.ts), so it wraps every server function: the
 * function's own middleware (requireSupabaseAuth), its input validator and its handler. start.ts
 * is loaded in the browser too, where the compiler removes `.server()`; that is why the reporter is
 * imported inside `.server()` and never at the top of this file.
 */
import { createMiddleware } from "@tanstack/react-start";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { isIgnorableError } from "@/lib/error-report";

/*
 * Which failures are reported.
 *
 * In this app a handler refuses on purpose by throwing a plain Error with a message for the person
 * to read: "Game not found.", "Only owners, managers and coaches can view this.", or a refusal the
 * database raised and the handler passes on (RAISE EXCEPTION 'EVENT_FULL'). The 71 *.functions.ts
 * files throw `new Error(…)` about 500 times. Refusals are answers, not failures: reporting them
 * would bury the real failures and use up the per-minute report budget. So the rule looks at what
 * was thrown:
 *
 * Never reported:
 *   - control flow: redirects, notFound, thrown Responses;
 *   - input validation: the ZodError an inputValidator throws, or the issue list TanStack throws
 *     for a schema validator;
 *   - auth refusals: requireSupabaseAuth's "Unauthorized: …", "Forbidden", "Not authenticated",
 *     AUTH_REQUIRED, NOT_SIGNED_IN, an expired or invalid JWT;
 *   - aborts, as everywhere else in error-report.ts (and nothing at all once the caller has gone).
 * Reported:
 *   - a database, network or upstream failure, even when the handler passed it on as
 *     `throw new Error(error.message)` (about 200 of those throws do): FAILURE_TEXTS are written by
 *     Postgres, PostgREST or the runtime, never by us. They are what breaks after a publish: a
 *     migration not applied ("relation … does not exist", "Could not find the function … in the
 *     schema cache"), a grant or policy missing, a timeout, Supabase unreachable. A test checks
 *     that no message the app writes itself (every string literal in src, so also the texts
 *     handlers throw from maps and mappers, and every RAISE EXCEPTION in supabase/migrations)
 *     matches one of them;
 *   - a JavaScript runtime error (TypeError, ReferenceError, SyntaxError…, or a TimeoutError):
 *     a bug or a failed call, never a refusal;
 *   - anything thrown that is not an Error and has no message (a string, undefined…).
 * Everything else, a plain Error or one of the app's own error classes (AiError…) with any other
 * message, is a refusal the handler meant the person to read, and is not reported.
 *
 * Not seen: a failure a handler has already replaced with its own text, as the mappers that turn
 * any unknown database error into "Something went wrong. Please try again." do. The original error
 * is gone by the time it gets here. (Keeping it as the new error's `cause` would not help: the
 * server-function serializer copies every own property, `cause` included, to the browser.)
 */

/** Texts that only Postgres, PostgREST or the runtime write. */
const FAILURE_TEXTS: readonly RegExp[] = [
  // The schema is not what the code expects: a migration not applied, or applied out of order.
  /\b(?:relation|table|view|column|function|procedure|type|schema|sequence) (?:"[^"]+"|[\w$]+(?:\.[\w$]+)+|[\w$.]+\([^)]*\))(?: of relation "[^"]+")? does not exist\b/i,
  /\boperator does not exist\b/i,
  /\bin the schema cache\b/i,
  /\bCould not choose the best candidate function\b/i,
  /\bfunction [\w$.]+\([^)]*\) is not unique\b/i,
  /\bdoes not match function result type\b/i,
  /\brecord "[^"]+" has no field\b/i,
  /\bcolumn reference "[^"]+" is ambiguous\b/i,
  /\bno unique or exclusion constraint matching the ON CONFLICT\b/i,
  // A grant or a row-level security policy refused the server's own query.
  /\bpermission denied for (?:table|relation|view|materialized view|function|procedure|schema|sequence|type|database|column|large object)\b/i,
  /\bviolates row-level security policy\b/i,
  /\binfinite recursion detected in (?:policy|rules)\b/i,
  // Data the code let through that the database refused.
  /\bviolates (?:unique|foreign key|check|not-null|exclusion) constraint\b/i,
  /\binvalid input (?:syntax|value) for (?:type|enum)\b/i,
  /\bvalue too long for type\b/i,
  /\bout of range for type\b/i,
  /\bJSON object requested, multiple \(or no\) rows returned\b/i,
  /\bCannot coerce the result to a single JSON object\b/i,
  // The database or a service is overloaded, slow or unreachable.
  /\bcanceling statement due to\b/i,
  /\bdeadlock detected\b/i,
  /\bcould not serialize access\b/i,
  /\bstack depth limit exceeded\b/i,
  /\btoo many (?:connections|clients)\b|\bremaining connection slots\b/i,
  /\bfetch failed\b/i,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|\bsocket hang up\b/,
  /\bupstream (?:connect error|request timeout)\b|\bno healthy upstream\b/i,
  // An upstream answered with an HTTP 5xx page (the status text as servers write it).
  /\b(?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b/,
];

const AUTH_REFUSAL =
  /^(?:Unauthorized|Forbidden|Not authenticated|AUTH_REQUIRED|NOT_SIGNED_IN|JWT expired|invalid JWT)\b/i;

/** Errors the JavaScript runtime throws (TimeoutError: AbortSignal.timeout). */
const RUNTIME_ERROR_NAMES = new Set([
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "TimeoutError",
]);

function messageOf(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

/** TanStack throws a schema validator's issues as JSON: `[{ "message": "…", "path": […] }, …]`. */
function isIssueList(message: string): boolean {
  if (!message.trimStart().startsWith("[")) return false;
  try {
    const parsed: unknown = JSON.parse(message);
    return (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (issue) =>
          issue !== null &&
          typeof issue === "object" &&
          typeof (issue as { message?: unknown }).message === "string",
      )
    );
  } catch {
    return false;
  }
}

function isValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ZodError" ||
    Array.isArray((error as { issues?: unknown }).issues) ||
    isIssueList(error.message)
  );
}

/** True when a server function's error is a failure worth recording (see the rule above). */
export function isReportableServerFnError(error: unknown): boolean {
  if (error instanceof Response || isRedirect(error) || isNotFound(error)) return false;
  if (isIgnorableError(error) || isValidationError(error)) return false;
  const message = messageOf(error);
  if (message !== null && AUTH_REFUSAL.test(message.trim())) return false;
  if (message !== null && FAILURE_TEXTS.some((text) => text.test(message))) return true;
  if (error instanceof Error) return RUNTIME_ERROR_NAMES.has(error.name);
  return message === null;
}

/**
 * The route a report is filed under: the function's name, because its RPC path holds only an
 * opaque id (and during server rendering, the page path says nothing about which function failed).
 */
export function serverFnRoute(meta: { name?: string } | null | undefined): string | null {
  const name = (meta?.name ?? "").replace(/[^\w$]/g, "").slice(0, 120);
  return name ? `/_serverFn/${name}` : null;
}

export const errorReportMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    try {
      return await next();
    } catch (error) {
      if (isReportableServerFnError(error)) {
        try {
          const [{ reportServerError }, { getRequest }] = await Promise.all([
            import("@/lib/error-report.server"),
            import("@tanstack/react-start/server"),
          ]);
          let request: Request | null = null;
          try {
            request = getRequest();
          } catch {
            request = null;
          }
          // Nobody is waiting for the answer any more: not a failure worth a row.
          if (!request?.signal.aborted) {
            await reportServerError(error, request, "server_fn", {
              route: serverFnRoute(serverFnMeta),
            });
          }
        } catch {
          // Reporting must never change what the caller gets back.
        }
      }
      throw error;
    }
  },
);
