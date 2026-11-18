/**
 * Answer a mocked PostgREST write the way PostgREST would, for the invite specs.
 *
 * `createJoinRequest` (src/lib/payments.ts) inserts with
 * `.insert(...).select("*").single()`. `.single()` asks PostgREST for one object
 * (`Accept: application/vnd.pgrst.object+json`) and supabase-js hands the body
 * back as `data` unchanged. A mock that always answers with an array makes the
 * app store that array as the viewer's request, so the page shows neither the
 * pending banner nor the "Request pending" CTA. Answering in the shape the
 * request asked for keeps the mock faithful to the real server.
 */
import type { Route } from "@playwright/test";

/** True when the request asked PostgREST for a single object rather than an array. */
export function wantsSingleObject(route: Route): boolean {
  const accept = route.request().headers()["accept"] ?? "";
  return accept.includes("application/vnd.pgrst.object+json");
}

/**
 * Fulfil a PostgREST request with `rows`: the first row as an object when the
 * client called `.single()`, otherwise the array.
 */
export async function fulfillRows(
  route: Route,
  rows: readonly unknown[],
  { status = 200 }: { status?: number } = {},
): Promise<void> {
  const single = wantsSingleObject(route);
  await route.fulfill({
    status,
    contentType: single ? "application/vnd.pgrst.object+json" : "application/json",
    headers: { "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" },
    body: JSON.stringify(single ? (rows[0] ?? null) : rows),
  });
}
