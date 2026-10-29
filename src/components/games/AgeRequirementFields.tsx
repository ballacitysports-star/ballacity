import { useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  AGE_MAX,
  AGE_MIN,
  AGE_PRESETS,
  ageRequirementLabel,
  clampAge,
  matchAgePreset,
} from "@/lib/game-age";
import { publicDiscoveryNote } from "@/lib/game-age-visibility";

/**
 * Host-facing age requirement editor. Presets cover the common cases in one
 * tap; "Custom" reveals min/max fields that only normalize on blur so typing
 * stays natural. Players outside the range must request the host's approval.
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
  const preset = matchAgePreset({ minAge, maxAge });
  const [custom, setCustom] = useState(preset === "custom");
  const [minText, setMinText] = useState(minAge == null ? "" : String(minAge));
  const [maxText, setMaxText] = useState(maxAge == null ? "" : String(maxAge));
  const label = ageRequirementLabel({ minAge, maxAge });
  const note = publicDiscoveryNote({ minAge, maxAge });
  const firstPreset = useRef<HTMLButtonElement>(null);

  // Keep the raw text in sync when values change from outside (presets, load).
  useEffect(() => {
    setMinText(minAge == null ? "" : String(minAge));
  }, [minAge]);
  useEffect(() => {
    setMaxText(maxAge == null ? "" : String(maxAge));
  }, [maxAge]);

  const normalize = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return clampAge(n);
  };

  const commitMin = () => {
    const next = normalize(minText);
    const nextMax = next != null && maxAge != null && maxAge < next ? next : maxAge;
    onChange({ minAge: next, maxAge: nextMax });
  };

  const commitMax = () => {
    const next = normalize(maxText);
    const bounded = next != null && minAge != null && next < minAge ? minAge : next;
    onChange({ minAge, maxAge: bounded });
  };

  const inputClass =
    "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime";

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" /> Age requirement
        </span>
        {label && (
          <span className="rounded-full border border-lime bg-lime/15 px-3 py-1 text-xs font-semibold text-lime">
            {label}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {AGE_PRESETS.map((p, i) => {
          const active = !custom && preset === p.id;
          return (
            <button
              key={p.id}
              ref={i === 0 ? firstPreset : undefined}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustom(false);
                onChange({ minAge: p.minAge, maxAge: p.maxAge });
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-lime bg-lime/15 text-lime"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => setCustom(true)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
            custom
              ? "border-lime bg-lime/15 text-lime"
              : "border-border bg-background text-muted-foreground"
          }`}
        >
          Custom
        </button>
      </div>

      {custom && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor={`${idPrefix}-min`}
              className="text-[11px] font-semibold text-muted-foreground"
            >
              Minimum age
            </label>
            <input
              id={`${idPrefix}-min`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              value={minText}
              placeholder="Any"
              onChange={(e) => setMinText(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={commitMin}
              className={inputClass}
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
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              value={maxText}
              placeholder="Any"
              onChange={(e) => setMaxText(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={commitMax}
              className={inputClass}
            />
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {label
          ? "Players outside this range — or without a birthday on their profile — must request your approval to join."
          : custom
            ? `Leave a field blank to keep that side open. Ages ${AGE_MIN}–${AGE_MAX}.`
            : "Pick a preset, or set your own range. Players outside it must request your approval."}
      </p>

      <p
        role="status"
        data-testid="age-public-discovery-note"
        data-kind={note.kind}
        className="mt-2 text-[11px] text-muted-foreground"
      >
        {note.text}
        {note.kind === "unset" && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => firstPreset.current?.focus()}
              className="font-semibold text-lime underline underline-offset-2"
            >
              Review age range
            </button>
          </>
        )}
      </p>
    </div>
  );
}
