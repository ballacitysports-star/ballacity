import { TZ_OPTIONS, type Tz, tzShortName } from "@/lib/tz";
import { Globe } from "lucide-react";

/**
 * Native <select> with grouped timezone options. Small on purpose — the
 * curated list in `src/lib/tz.ts` covers the common trainer markets. If a
 * trainer's actual IANA zone isn't in the list (e.g. carried over from an
 * older device), we still render it as a valid option so they can save
 * without being forced to change it.
 */
export function TimezoneSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: Tz;
  onChange: (next: Tz) => void;
  disabled?: boolean;
  className?: string;
}) {
  const known = new Set(TZ_OPTIONS.flatMap((g) => g.zones.map((z) => z.value)));
  const isCustom = value && !known.has(value);
  const short = tzShortName(new Date(), value);
  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 ${className ?? ""}`}
    >
      <Globe className="h-4 w-4 text-lime shrink-0" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-foreground outline-none disabled:opacity-60"
      >
        {isCustom && (
          <option value={value}>
            {value.replace(/_/g, " ")} · {short}
          </option>
        )}
        {TZ_OPTIONS.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
        {short}
      </span>
    </div>
  );
}
