import { CalendarClock } from "lucide-react";
import { AGE_MAX, AGE_MIN, ageRequirementLabel, clampAge } from "@/lib/game-age";

/**
 * Host-facing age requirement editor: off by default, with an optional
 * minimum and/or maximum age. Players outside the range must request the
 * host's approval to join.
 */
export function AgeRequirementFields({
  minAge,
  maxAge,
  onChange,
  idPrefix = "age-req",
}: {
  minAge: number | null;
  maxAge: number | null;
  onChange: (next: { minAge: number | null; maxAge: number | null }) => void;
  idPrefix?: string;
}) {
  const enabled = minAge != null || maxAge != null;
  const label = ageRequirementLabel({ minAge, maxAge });

  const parse = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return clampAge(n);
  };

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" /> Age requirement
        </span>
        <button
          type="button"
          onClick={() => onChange(enabled ? { minAge: null, maxAge: null } : { minAge: 18, maxAge: null })}
          aria-pressed={enabled}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
            enabled
              ? "border-lime bg-lime/15 text-lime"
              : "border-border bg-background text-muted-foreground"
          }`}
        >
          {enabled ? (label ?? "On") : "Any age"}
        </button>
      </div>

      {enabled && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor={`${idPrefix}-min`}
              className="text-[11px] font-semibold text-muted-foreground"
            >
              Minimum age
            </label>
            <input
              id={`${idPrefix}-min`}
              type="number"
              inputMode="numeric"
              min={AGE_MIN}
              max={AGE_MAX}
              value={minAge ?? ""}
              placeholder="Any"
              onChange={(e) => onChange({ minAge: parse(e.target.value), maxAge })}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-max`}
              className="text-[11px] font-semibold text-muted-foreground"
            >
              Maximum age
            </label>
            <input
              id={`${idPrefix}-max`}
              type="number"
              inputMode="numeric"
              min={AGE_MIN}
              max={AGE_MAX}
              value={maxAge ?? ""}
              placeholder="Any"
              onChange={(e) => onChange({ minAge, maxAge: parse(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
            />
          </div>
        </div>
      )}

      <p className="mt-1 text-[11px] text-muted-foreground">
        {enabled
          ? "Players outside this range — or without a birthday on their profile — must request your approval to join."
          : "Set a minimum and/or maximum age. Players outside the range must request your approval."}
      </p>
    </div>
  );
}
