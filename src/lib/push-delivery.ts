/**
 * Push outcomes as notification_delivery_log records them (its `error` column), shared by the
 * server code that writes them (push.server, the flush job) and the notifications panel that
 * reads them. Client-safe: no server imports.
 */

/** deliverPush held the push for the flush job: the recipient is a minor in their quiet hours. */
export const HELD_FOR_CURFEW = "minor_notification_curfew";
/** deliverPush held the push for the flush job: the minor-safety settings could not be read. */
export const HELD_CHECK_FAILED = "curfew_check_failed";
/** deliverPush dropped the push: it would have arrived at or after its expiry (a game's start). */
export const EXPIRED = "expired";

/**
 * Logged reasons that are not a delivery problem: the push is held and goes out later, or it was
 * dropped because it stopped mattering. The "Push delivery issue" banner leaves them out.
 */
export const NOT_DELIVERY_ISSUES: readonly string[] = [HELD_FOR_CURFEW, HELD_CHECK_FAILED, EXPIRED];

/** Whether a failed or skipped push log row is a delivery problem the member should hear about. */
export function isDeliveryIssue(row: { error: string | null }): boolean {
  return !row.error || !NOT_DELIVERY_ISSUES.includes(row.error);
}

export type DeliveryIssue = {
  id: string;
  created_at: string;
  error: string | null;
  notification_id: string | null;
};

type LogQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  select: (columns: string) => LogQuery;
  eq: (column: string, value: unknown) => LogQuery;
  in: (column: string, values: readonly unknown[]) => LogQuery;
  or: (filters: string) => LogQuery;
  gte: (column: string, value: string) => LogQuery;
  order: (column: string, opts: { ascending: boolean }) => LogQuery;
  limit: (count: number) => LogQuery;
};
/** The part of a Supabase client this file uses. */
export type DeliveryLogReader = { from: (table: string) => LogQuery };

/**
 * The member's push delivery problems from the last 7 days, newest first, at most 10: failed or
 * skipped pushes, without held or expired ones. The query leaves those out too, so the held
 * pushes of a minor's quiet hours cannot crowd real failures out of the 10 rows.
 */
export async function loadPushDeliveryIssues(
  client: DeliveryLogReader,
  userId: string,
  now: number = Date.now(),
): Promise<DeliveryIssue[]> {
  const since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("notification_delivery_log")
    .select("id, created_at, error, notification_id, status, channel")
    .eq("user_id", userId)
    .eq("channel", "push")
    .in("status", ["failed", "skipped"])
    .or(`error.is.null,error.not.in.(${NOT_DELIVERY_ISSUES.join(",")})`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  return ((data ?? []) as DeliveryIssue[]).filter(isDeliveryIssue).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    error: r.error,
    notification_id: r.notification_id,
  }));
}
