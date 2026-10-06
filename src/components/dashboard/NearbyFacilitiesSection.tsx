import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin, ShieldCheck } from "lucide-react";
import {
  CarouselItem,
  DashboardCarousel,
  DashboardSection,
} from "@/components/dashboard/DashboardSection";
import type { OrgDirectoryRow } from "@/components/org/OrgDirectoryCard";
import { ResponsiveImage } from "@/components/ResponsiveImage";
import {
  facilityActivityLabel,
  facilityRunCounts,
  rankNearbyFacilities,
} from "@/lib/curated-dashboard";
import { formatDistance } from "@/lib/distance";
import { postFacilityEventSearch } from "@/lib/facility-events";
import type { LatLng } from "@/lib/geo";
import type { DistanceUnit } from "@/lib/measurement-system";
import { describeOpenBadge, parseHours, type OpenBadge } from "@/lib/org-hours";
import { highlightAmenities } from "@/lib/org-listing";
import type { Game } from "@/lib/sample-data";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";

const OPEN_TONE: Record<OpenBadge["tone"], { dot: string; text: string }> = {
  open: { dot: "bg-emerald-500", text: "text-foreground" },
  closing: { dot: "bg-amber-500", text: "text-foreground" },
  closed: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
  unknown: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

type RankedFacility = OrgDirectoryRow & { distanceMi: number | null };

function FacilityCard({
  org,
  runs,
  now,
  unit,
}: {
  org: RankedFacility;
  runs: number;
  now: Date;
  unit: DistanceUnit;
}) {
  const hero = org.cover_url ?? org.photos?.[0] ?? null;
  const badge = describeOpenBadge(parseHours(org.hours), org.timezone, now);
  const tone = OPEN_TONE[badge.tone];
  const { tags } = highlightAmenities(org.amenities, 4);
  const hosting = runs === 0;

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      <Link to="/orgs/$orgId" params={{ orgId: org.id }} className="group block">
        <div className="relative aspect-[16/9] bg-secondary/40">
          {hero ? (
            <ResponsiveImage
              src={hero}
              alt={`${org.name} courts`}
              aspect={16 / 9}
              widths={[320, 480, 640]}
              sizes="(min-width: 640px) 19rem, 80vw"
              baseWidth={480}
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-lime-gradient">
              <span
                aria-hidden
                className="font-display text-4xl font-bold text-primary-foreground/90"
              >
                {org.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <span
            className={`absolute left-2 top-2 inline-flex max-w-[92%] items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-[11px] backdrop-blur ${tone.text}`}
            suppressHydrationWarning
          >
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
            <span className="shrink-0 font-bold">{badge.headline}</span>
            {badge.detail && <span className="truncate">· {badge.detail}</span>}
          </span>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-display text-base font-bold leading-tight">
            <Link to="/orgs/$orgId" params={{ orgId: org.id }} className="truncate hover:underline">
              {org.name}
            </Link>
            {org.verified && (
              <ShieldCheck className="h-4 w-4 shrink-0 text-lime" aria-label="Verified" />
            )}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0 text-coral" />
            <span className="truncate">
              {org.distanceMi != null
                ? `${formatDistance(org.distanceMi, unit, org.distanceMi < 10 ? 1 : 0)} away`
                : (org.city ?? org.address ?? "Location on profile")}
            </span>
          </p>
        </div>

        {tags.length > 0 && (
          <ul aria-label="Amenities" className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <li key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                {t}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">{facilityActivityLabel(runs)}</p>

        {hosting ? (
          <Link
            to="/create"
            search={postFacilityEventSearch(org.id, "run")}
            className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-lime-gradient px-4 text-sm font-bold text-primary-foreground glow-lime"
          >
            Host a run here
          </Link>
        ) : (
          <Link
            to="/orgs/$orgId"
            params={{ orgId: org.id }}
            className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-lime-gradient px-4 text-sm font-bold text-primary-foreground glow-lime"
          >
            View Courts &amp; Runs
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Section 3 of the dashboard: gyms and courts near the viewer, with whether
 * they are open right now, their amenities and how much is being played
 * there this week. Nearest first once the viewer has shared a location.
 */
export function NearbyFacilitiesSection({
  games,
  viewer,
  unit,
}: {
  /** Every public game, so facilities can show this week's run counts. */
  games: readonly Game[];
  viewer: LatLng | null;
  unit: DistanceUnit;
}) {
  const [now] = useState(() => new Date());
  const { data, isLoading } = useQuery({
    queryKey: ["discover-gyms", ""],
    queryFn: () => listTrainerOrgs({ data: {} }),
    staleTime: 60_000,
  });

  const counts = useMemo(() => facilityRunCounts(games, now.getTime()), [games, now]);
  const ranked = useMemo(
    () => rankNearbyFacilities((data ?? []) as unknown as OrgDirectoryRow[], viewer, counts),
    [data, viewer, counts],
  );

  if (!isLoading && ranked.length === 0) return null;

  return (
    <DashboardSection
      id="nearby-facilities"
      emoji="📍"
      title="Nearby Courts & Facilities"
      action={
        <Link to="/orgs" className="text-lime">
          Explore all gyms
        </Link>
      }
    >
      {isLoading ? (
        <div
          className="h-64 animate-pulse rounded-2xl border border-border bg-surface"
          aria-hidden
        />
      ) : (
        <DashboardCarousel label="Courts and facilities near you">
          {ranked.map((org) => (
            <CarouselItem key={org.id}>
              <FacilityCard org={org} runs={counts.get(org.id) ?? 0} now={now} unit={unit} />
            </CarouselItem>
          ))}
        </DashboardCarousel>
      )}
    </DashboardSection>
  );
}
