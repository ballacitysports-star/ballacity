import { REMINDER_PRESETS, formatDuration } from "@/lib/datetime";
import { DtChip, DtLabel, DtSummary } from "./primitives";

/** Lead times to remind joined players before the start. */
export function ReminderField({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const toggle = (min: number) => {
    const set = new Set(value);
    if (set.has(min)) set.delete(min);
    else set.add(min);
    onChange([...set].sort((a, b) => b - a));
  };

  return (
    <div className="space-y-1.5">
      <DtLabel>Remind players</DtLabel>
      <div className="flex flex-wrap gap-1.5">
        {REMINDER_PRESETS.map((p) => (
          <DtChip key={p.min} active={value.includes(p.min)} onClick={() => toggle(p.min)}>
            {p.label}
          </DtChip>
        ))}
      </div>
      <DtSummary>
        {value.length
          ? `Reminders ${value.map((m) => `${formatDuration(m)} before`).join(", ")}.`
          : "No reminders."}
      </DtSummary>
    </div>
  );
}
