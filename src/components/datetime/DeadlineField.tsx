import {
  RELATIVE_DEADLINE_PRESETS,
  formatDeadline,
  type Deadline,
  type EventWhen,
} from "@/lib/datetime";
import { DtChip, DtLabel, DtSummary, dtInputCls } from "./primitives";

/**
 * One control for every deadline in the app (signup cutoff, RSVP, payment):
 * relative to the start, or pinned to an exact moment.
 */
export function DeadlineField({
  label,
  when,
  value,
  onChange,
  allowNone = true,
  hint,
}: {
  label: string;
  when: EventWhen;
  value: Deadline;
  onChange: (next: Deadline) => void;
  allowNone?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <DtLabel>{label}</DtLabel>
      <div className="flex flex-wrap gap-1.5">
        {allowNone && (
          <DtChip active={value.kind === "none"} onClick={() => onChange({ kind: "none" })}>
            None
          </DtChip>
        )}
        {RELATIVE_DEADLINE_PRESETS.map((p) => (
          <DtChip
            key={p.min}
            active={value.kind === "relative" && value.minutesBefore === p.min}
            onClick={() => onChange({ kind: "relative", minutesBefore: p.min })}
          >
            {p.label}
          </DtChip>
        ))}
        <DtChip
          active={value.kind === "absolute"}
          onClick={() => onChange({ kind: "absolute", at: when.start })}
        >
          Exact time
        </DtChip>
      </div>

      {value.kind === "absolute" && (
        <input
          type="datetime-local"
          aria-label={`${label} exact time`}
          value={toLocalInput(value.at)}
          onChange={(e) => onChange({ kind: "absolute", at: fromLocalInput(e.target.value) })}
          className={`w-full ${dtInputCls}`}
        />
      )}

      <DtSummary>
        {hint ? `${formatDeadline(when, value)} · ${hint}` : formatDeadline(when, value)}
      </DtSummary>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

function fromLocalInput(v: string): string {
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}
