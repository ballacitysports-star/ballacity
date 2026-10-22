import { MapPin } from "lucide-react";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { Field } from "@/components/profile/ProfileFormPrimitives";
import { useDistanceUnit } from "@/lib/user-prefs-store";
import { DistanceSlider } from "@/components/DistanceSlider";
import { MAX_DISTANCE_MI, clampDistanceMi, maxDistanceInUnit, miToKm } from "@/lib/distance";

export type ProfileLocationValue = {
  /** City name, same field as the basics city. */
  city: string;
  /** Saved search radius, canonical in miles. */
  searchRadiusMi: number;
};

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

        <div className="mt-3">
          <DistanceSlider
            valueMi={radiusMi >= MAX_DISTANCE_MI ? null : radiusMi}
            onChange={(mi) =>
              onChange({
                searchRadiusMi:
                  mi == null ? MAX_DISTANCE_MI : (clampDistanceMi(Math.round(mi)) as number),
              })
            }
            unit={unit}
            label="Search radius"
          />
        </div>
      </Field>
    </>
  );
}
