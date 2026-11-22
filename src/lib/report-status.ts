/**
 * Which stored `user_reports.status` values each queue status covers.
 *
 * New reports are written as "new" (`submitReport` in moderation.ts). Older rows still carry the legacy names
 * "pending", "open", "reviewing" and "actioned". The moderation queue, the superadmin Overview, AttentionStrip and the
 * compliance page all count with this one map, so their numbers agree.
 */
export const REPORT_STATUS_GROUPS = {
  new: ["new", "pending", "open"],
  investigating: ["investigating", "reviewing"],
  resolved: ["resolved", "actioned"],
  dismissed: ["dismissed"],
  escalated: ["escalated"],
} as const satisfies Record<string, readonly string[]>;

/** Reports nobody has picked up yet: the "New" queue. */
export const OPEN_REPORT_STATUSES: readonly string[] = REPORT_STATUS_GROUPS.new;

/** The stored values a queue status covers. An unknown status covers only itself. */
export function reportStatusesFor(status: string): string[] {
  const group = (REPORT_STATUS_GROUPS as Record<string, readonly string[]>)[status];
  return [...(group ?? [status])];
}
