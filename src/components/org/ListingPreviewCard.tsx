import { Building2, Clock, MapPin, Phone, Globe, Navigation, Share2, Star } from "lucide-react";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import {
  WEEKDAYS,
  dayHours,
  formatDayHours,
  hasAnyHours,
  localNow,
  resolveOpenState,
  type OrgHours,
} from "@/lib/org-hours";
import { courtCountFromAmenities, courtCountLabel } from "@/lib/org-listing";

export type ListingPreview = {
  name: string;
  category: string;
  handle: string;
  address: string;
  city: string;
  phone: string;
  website: string;
  avatarUrl: string;
  coverUrl: string;
  photos: string[];
  amenities: string[];
  hours: OrgHours;
  timezone?: string | null;
  geo?: { lat: number; lng: number } | null;
  placeId?: string | null;
  verified?: boolean;
  rating?: number | null;
  reviewCount?: number;
};

/**
 * Google-listing style header card. Shared by the editor's live preview and
 * the public gym page so both always look identical.
 */
export function ListingPreviewCard({
  v,
  compact,
  onOpenPhoto,
}: {
  v: ListingPreview;
  compact?: boolean;
  onOpenPhoto?: (index: number) => void;
}) {
  const strip = [v.coverUrl, ...v.photos].filter(Boolean);
  const open = resolveOpenState(v.hours, v.timezone);
  const today = localNow(v.timezone).day;
  const courts = courtCountFromAmenities(v.amenities);
  const chips = v.amenities.filter((a) => courtCountFromAmenities([a]) === null);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-surface">
      {strip.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto">
          {strip.slice(0, 6).map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => onOpenPhoto?.(i)}
              className={`${i === 0 ? "w-2/3 shrink-0" : "w-1/3 shrink-0"} ${compact ? "h-24" : "h-32 sm:h-44"}`}
            >
              <img
                src={src}
                alt={`${v.name || "Gym"} photo ${i + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : (
        <div
          className={`grid ${compact ? "h-24" : "h-32 sm:h-40"} place-items-center bg-secondary/40`}
        >
          <Building2 className="h-7 w-7 text-muted-foreground" />
        </div>
      )}

      <div className="space-y-2 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-lime/15">
            {v.avatarUrl ? (
              <img src={v.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Building2 className="h-5 w-5 text-lime" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold leading-tight truncate">
              {v.name || "Your gym name"}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {typeof v.rating === "number" && (
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {v.rating.toFixed(1)}
                  {v.reviewCount ? ` (${v.reviewCount})` : ""}
                </span>
              )}
              <span>{v.category || "Category"}</span>
              {v.city && <span>· {v.city}</span>}
            </div>
            <div className="mt-1 text-xs">
              <span
                className={
                  open.status === "open"
                    ? open.closingSoon
                      ? "rounded-full bg-amber-500/15 px-2 py-0.5 font-bold text-amber-500"
                      : "rounded-full bg-lime/15 px-2 py-0.5 font-bold text-lime"
                    : "rounded-full bg-secondary px-2 py-0.5 font-bold text-muted-foreground"
                }
              >
                {open.status === "open"
                  ? "Open"
                  : open.status === "closed"
                    ? "Closed"
                    : "Hours not set"}
              </span>
              {open.status !== "unknown" && (
                <span className="text-muted-foreground">
                  {" "}
                  · {open.label.replace(/^(Open|Closed) · /, "")}
                </span>
              )}
            </div>
          </div>
        </div>

        {v.address && (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{" "}
            <span className="min-w-0">{v.address}</span>
          </div>
        )}

        {hasAnyHours(v.hours) && (
          <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3 w-3" /> Weekly hours
            </div>
            <ul className="space-y-0.5 text-[11px]">
              {WEEKDAYS.map((label, d) => (
                <li
                  key={label}
                  className={`flex justify-between gap-3 ${d === today ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                >
                  <span>{label.slice(0, 3)}</span>
                  <span>{formatDayHours(dayHours(v.hours, d))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {v.geo && (
          <div className="overflow-hidden rounded-xl border border-border/60">
            <VenueMapPreview
              address={v.address || v.name}
              lat={v.geo.lat}
              lng={v.geo.lng}
              placeId={v.placeId || undefined}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1">
          {[
            { icon: Navigation, label: "Directions" },
            { icon: Phone, label: "Call" },
            { icon: Globe, label: "Website" },
            { icon: Share2, label: "Share" },
          ].map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
            >
              <Icon className="h-3 w-3" /> {label}
            </span>
          ))}
        </div>

        {(courts || chips.length > 0) && (
          <div className="flex flex-wrap gap-1 pt-1">
            {courts ? (
              <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-semibold text-lime">
                {courtCountLabel(courts)}
              </span>
            ) : null}
            {chips.slice(0, 10).map((a) => (
              <span key={a} className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                {a}
              </span>
            ))}
            {chips.length > 10 && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                +{chips.length - 10} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
