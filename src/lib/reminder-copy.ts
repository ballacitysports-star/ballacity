import { REMINDER_PRESETS, formatDuration } from "@/lib/datetime";

/**
 * "1 day before", "2 hours before": a preset's own chip label, so the summary
 * under the chips reads like the chips. formatDuration(1440) is "All day"
 * (right for an event's length, and other screens rely on it), which made the
 * reminder line say "All day before".
 */
export function reminderLeadLabel(minutes: number): string {
  const preset = REMINDER_PRESETS.find((p) => p.min === minutes);
  return preset ? preset.label : `${formatDuration(minutes)} before`;
}

/** "1 day before and 2 hours before" */
export function reminderLeadSummary(offsets: readonly number[]): string {
  return offsets.map(reminderLeadLabel).join(" and ");
}
