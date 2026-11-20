import { Slider } from "@/components/ui/slider";
import {
  DISTANCE_SLIDER_STOPS,
  distanceFromSliderIndex,
  distanceSliderIndex,
} from "@/lib/distance";
import type { DistanceUnit } from "@/lib/measurement-system";

/**
 * One slider for "how far", in the viewer's unit. Slide left for closer, all
 * the way right for any distance. The value is a limit in miles (null = any),
 * whatever unit it is shown in.
 */
export function DistanceSlider({
  valueMi,
  onChange,
  unit,
  disabled,
  label = "Distance",
}: {
  valueMi: number | null;
  onChange: (mi: number | null) => void;
  unit: DistanceUnit;
  disabled?: boolean;
  label?: string;
}) {
  const index = distanceSliderIndex(valueMi, unit);
  const stop = DISTANCE_SLIDER_STOPS[index];
  // Disabled: only the track and thumb fade. The labels keep full contrast (faded to 50%, the
  // 10px stop labels read 2.5:1), and the value line says the filter is off instead.
  return (
    <div className={disabled ? "pointer-events-none" : ""} aria-disabled={disabled || undefined}>
      <p
        className={`mb-3 text-sm font-semibold${disabled ? " text-muted-foreground" : ""}`}
        aria-live="polite"
      >
        {disabled
          ? "Distance filter off"
          : stop == null
            ? "Any distance"
            : `Within ${stop} ${unit}`}
      </p>
      <Slider
        className={disabled ? "opacity-50" : undefined}
        value={[index]}
        min={0}
        max={DISTANCE_SLIDER_STOPS.length}
        step={1}
        onValueChange={(v) => onChange(distanceFromSliderIndex(v[0] ?? 0, unit))}
        aria-label={label}
        disabled={disabled}
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>
          {DISTANCE_SLIDER_STOPS[0]} {unit}
        </span>
        <span>Any</span>
      </div>
    </div>
  );
}
