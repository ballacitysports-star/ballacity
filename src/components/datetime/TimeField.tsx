import { formatTimeKey, isTimeKey } from "@/lib/datetime";
import { dtInputCls } from "./primitives";

/**
 * Minute-precise time input. Uses the native picker (best on mobile) with a
 * 5-minute step by default, and shows the readable label next to it.
 */
export function TimeField({
  value,
  onChange,
  label,
  step = 300,
  showLabel = false,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** Seconds; 300 = 5-minute steps, 60 = any minute. */
  step?: number;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="time"
        aria-label={label}
        step={step}
        value={isTimeKey(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={`w-[7.5rem] ${dtInputCls} ${className}`}
      />
      {showLabel && isTimeKey(value) && (
        <span className="text-xs text-muted-foreground">{formatTimeKey(value)}</span>
      )}
    </span>
  );
}
