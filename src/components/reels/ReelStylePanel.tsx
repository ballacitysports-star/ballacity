import { Sliders, Check } from "lucide-react";
import {
  OVERLAY_THEME_OPTIONS,
  PACING_OPTIONS,
  VIBE_OPTIONS,
  reelStyleSummary,
  type ReelStylePrefs,
} from "@/lib/reel-style";

type Group<T extends string> = {
  title: string;
  hint: string;
  options: { value: T; label: string; blurb: string }[];
  value: T;
  onSelect: (v: T) => void;
};

function ChipGroup<T extends string>({ title, hint, options, value, onSelect }: Group<T>) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(o.value)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-lime bg-lime/10 text-lime"
                  : "border-border bg-background/40 text-foreground hover:border-lime/40"
              }`}
            >
              <span className="flex items-center gap-1 text-xs font-semibold">
                {active && <Check className="h-3 w-3" aria-hidden />}
                {o.label}
              </span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">{o.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Style preferences the athlete sets *before* uploading: editing vibe, pacing,
 * and overlay theme. The choice is stored on the reel row and drives every AI
 * step (cut list, copy, overlays), so the highlight matches the requested look.
 */
export function ReelStylePanel({
  value,
  onChange,
  disabled,
  sport,
}: {
  value: ReelStylePrefs;
  onChange: (next: ReelStylePrefs) => void;
  disabled?: boolean;
  /** Sport this style applies to — defaults are tuned per sport. */
  sport?: string | null;
}) {
  return (
    <section
      className={`mx-5 mb-5 rounded-2xl border border-border bg-surface p-5 ${
        disabled ? "opacity-60" : ""
      }`}
      aria-label="Reel style preferences"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sliders className="h-4 w-4 text-lime" aria-hidden /> Reel style
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the look before the AI edits — applied to every new reel you upload.
            {sport ? (
              <>
                {" "}
                Starting points are tuned for{" "}
                <span className="font-semibold text-foreground">{sport}</span>, and tweaks are
                remembered per sport.
              </>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-lime/40 bg-lime/10 px-2 py-1 text-[10px] font-semibold text-lime">
          {reelStyleSummary(value)}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <ChipGroup
          title="Editing vibe"
          hint="How the highlight should feel and sound."
          options={VIBE_OPTIONS}
          value={value.vibe}
          onSelect={(vibe) => onChange({ ...value, vibe })}
        />
        <ChipGroup
          title="Pacing"
          hint="How long the cut runs and how fast it moves."
          options={PACING_OPTIONS}
          value={value.pacing}
          onSelect={(pacing) => onChange({ ...value, pacing })}
        />
        <ChipGroup
          title="Overlay theme"
          hint="Wording style for on-screen text cards."
          options={OVERLAY_THEME_OPTIONS}
          value={value.overlayTheme}
          onSelect={(overlayTheme) => onChange({ ...value, overlayTheme })}
        />
      </div>
    </section>
  );
}
