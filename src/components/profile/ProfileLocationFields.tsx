import { MapPin } from "lucide-react";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { Field } from "@/components/profile/ProfileFormPrimitives";
import { useDistanceUnit } from "@/lib/user-prefs-store";
import {
  MAX_DISTANCE_MI,
  clampDistanceMi,
  kmToMi,
  maxDistanceInUnit,
  miToKm,
} from "@/lib/distance";

export type ProfileLocationValue = {
  /** City name, same field as the basics city. */
  city: string;
  /** Saved search radius, canonical in miles. */
  searchRadiusMi: number;
};

const STEPS_MI = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, MAX_DISTANCE_MI];
const STEPS_KM = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * Canonical "Location preference" fields (city + search radius). Rendered by
 * both onboarding and Edit profile so the two can never drift.
 */
export function ProfileLocationFields({
  value,
  onChange,
  showCity = true,
}: {
  value: ProfileLocationValue;
  onChange: (patch: Partial<ProfileLocationValue>) => void;
  showCity?: boolean;
}) {
  const unit = useDistanceUnit();
  const capInUnit = maxDistanceInUnit(unit);
  const radiusMi = clampDistanceMi(value.searchRadiusMi || 25) as number;
  const display = Math.round(unit === "km" ? miToKm(radiusMi) : radiusMi);

  const setFromUnit = (v: number) => {
    const mi = unit === "km" ? kmToMi(v) : v;
    onChange({ searchRadiusMi: clampDistanceMi(Math.round(mi)) as number });
  };

  const chips = (unit === "km" ? STEPS_KM : STEPS_MI)
    .filter((v) => v <= capInUnit)
    .concat(capInUnit);

  return (
    <>
      {showCity && (
        <Field label="City">
          <LocationAutocomplete
            value={value.city}
            onChange={(v) => onChange({ city: v })}
            placeholder="Your city"
            mode="city"
          />
        </Field>
      )}

      <Field label="Search radius">
        <p className="mb-2 text-xs text-muted-foreground">
          How far you&apos;re willing to travel — up to {capInUnit.toLocaleString("en-US")} {unit}.
        </p>
        <div className="flex items-center justify-between text-sm font-semibold">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-lime" />
            {value.city?.trim() || "Anywhere"}
          </span>
          <span>
            up to {display.toLocaleString("en-US")} {unit}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from(new Set(chips)).map((v) => {
            const active = display === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setFromUnit(v)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-foreground"
                }`}
              >
                {v === capInUnit
                  ? `${v.toLocaleString("en-US")} ${unit} (anywhere)`
                  : `${v} ${unit}`}
              </button>
            );
          })}
        </div>

        <input
          type="number"
          min={1}
          max={capInUnit}
          value={display}
          onChange={(e) => setFromUnit(Number(e.target.value) || 1)}
          aria-label={`Search radius in ${unit === "km" ? "kilometers" : "miles"}`}
          className="mt-3 w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-lime/60"
        />
      </Field>
    </>
  );
}
