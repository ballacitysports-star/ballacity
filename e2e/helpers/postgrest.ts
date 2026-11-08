import type { Route } from "@playwright/test";

/**
 * The body PostgREST itself would send for `rows`.
 *
 * A supabase-js call that ends in `.single()` or `.maybeSingle()` asks for ONE
 * object (`Accept: application/vnd.pgrst.object+json`), and PostgREST answers
 * with that object, not an array. supabase-js passes the body through as
 * `data`, so a mock that always answers with an array hands the app an array
 * where it expects a row: `createJoinRequest` (src/lib/payments.ts, which
 * inserts with `.select("*").single()`) then read `created.status` as
 * undefined and the game page rendered "Request declined" instead of the
 * pending state the request specs wait for.
 *
 * Use it for every mocked write or read whose caller may be `.single()`;
 * for a list request it returns the array unchanged.
 */
export function pgrstBody(route: Route, rows: unknown[]): string {
  const accept = route.request().headers()["accept"] ?? "";
  if (accept.includes("application/vnd.pgrst.object")) {
    return JSON.stringify(rows[0] ?? null);
  }
  return JSON.stringify(rows);
}
