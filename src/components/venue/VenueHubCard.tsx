import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, CalendarDays, ExternalLink, ShieldCheck, Users } from "lucide-react";
import { ResponsiveImage } from "@/components/ResponsiveImage";
import { CourtInquiryDialog } from "@/components/org/CourtInquiryDialog";
import { describeOpenBadge, parseHours, type OpenBadge } from "@/lib/org-hours";
import { highlightAmenities } from "@/lib/org-listing";
import { otherRunsLabel, useFacilityHub } from "@/lib/facility-hub";

const OPEN_TONE: Record<OpenBadge["tone"], string> = {
  open: "text-lime",
  closing: "text-amber-500",
  closed: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

/**
 * Game page "venue hub": the registered facility a run is hosted at, with
 * live hours, amenities, the rest of its week and one-tap ways into the
 * facility profile, booking and inquiries. Renders nothing for games that
 * aren't at a registered, public facility.
 */
export function VenueHubCard({
  orgId,
  gameId,
  official,
  indoor,
}: {
  orgId: string | null | undefined;
  gameId?: string;
  /** Posted by the facility's own owner/admins (vs. a community run). */
  official?: boolean;
  indoor?: boolean;
}) {
  const q = useFacilityHub(orgId, gameId);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [now] = useState(() => new Date());
  const org = q.data;
  if (!orgId || !org) return null;

  const badge = describeOpenBadge(parseHours(org.hours), org.timezone, now);
  const { tags, more } = highlightAmenities(org.amenities, 6);
  const profileLabel = `View ${org.name} profile and weekly schedule`;

  return (
    <section
      aria-label={`Hosted at ${org.name}`}
      className="overflow-hidden border-t border-border/60 bg-surface text-sm"
    >
      <div className="relative aspect-[21/9] bg-secondary/40">
        {org.coverUrl ? (
          <ResponsiveImage
            src={org.coverUrl}
            alt={`${org.name} courts`}
            aspect={21 / 9}
            widths={[320, 480, 640, 960]}
            sizes="(min-width: 768px) 640px, 100vw"
            baseWidth={640}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-lime-gradient">
            {org.avatarUrl ? (
              <img
                src={org.avatarUrl}
                alt=""
                className="h-14 w-14 rounded-2xl border-2 border-background/40 object-cover"
              />
            ) : (
              <span aria-hidden className="font-display text-3xl font-bold text-primary-foreground">
                {org.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        )}
        <span
          className={`absolute right-2.5 top-2.5 inline-flex max-w-[70%] items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[11px] ${OPEN_TONE[badge.tone]}`}
        >
          <span className="shrink-0 font-bold">{badge.headline}</span>
          {badge.detail && (
            <span className="truncate font-medium text-foreground">{badge.detail}</span>
          )}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Hosted at
          </div>
          <Link
            to="/orgs/$orgId"
            params={{ orgId: org.id }}
            aria-label={profileLabel}
            className="inline-flex max-w-full items-center gap-1.5 font-display text-lg font-bold hover:text-lime"
          >
            <span className="truncate">{org.name}</span>
            {org.verified && (
              <ShieldCheck className="h-4 w-4 shrink-0 text-lime" aria-label="Verified facility" />
            )}
          </Link>
          {org.place && <div className="text-xs text-muted-foreground">{org.place}</div>}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {official !== undefined && (
              <span
                className={
                  official
                    ? "inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground"
                    : "inline-flex items-center rounded-full border-2 border-foreground/50 px-2.5 py-0.5 text-[11px] font-bold text-foreground"
                }
              >
                {official && <BadgeCheck className="h-3 w-3" aria-hidden />}
                {official ? "Official event" : "Community run"}
              </span>
            )}
            {indoor !== undefined && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${
                  indoor ? "bg-sky-700" : "bg-emerald-700"
                }`}
              >
                {indoor ? "Indoor" : "Outdoor"}
              </span>
            )}
          </div>
        </div>

        {tags.length > 0 && (
          <ul aria-label="Venue amenities" className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <li
                key={t}
                className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground"
              >
                {t}
              </li>
            ))}
            {more > 0 && (
              <li className="px-1 py-0.5 text-[11px] text-muted-foreground">+{more} more</li>
            )}
          </ul>
        )}

        <Link
          to="/orgs/$orgId"
          params={{ orgId: org.id }}
          hash="facility-events"
          aria-label={`${otherRunsLabel(org.otherRuns)} at ${org.name}`}
          className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold hover:border-lime/60"
        >
          {org.otherRuns ? (
            <Users className="h-4 w-4 shrink-0 text-lime" />
          ) : (
            <CalendarDays className="h-4 w-4 shrink-0 text-lime" />
          )}
          <span className="min-w-0 flex-1">{otherRunsLabel(org.otherRuns)}</span>
          <span className="text-xs text-lime">Schedule →</span>
        </Link>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/orgs/$orgId"
            params={{ orgId: org.id }}
            aria-label={profileLabel}
            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full border border-lime/50 bg-lime/10 px-4 text-xs font-bold text-lime hover:bg-lime/20"
          >
            View facility profile
          </Link>
          {org.booking ? (
            <a
              href={org.booking}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Book a court at ${org.name} (opens their booking page)`}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-lime px-4 text-xs font-bold text-primary-foreground hover:opacity-90"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Book a court
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setInquiryOpen(true)}
              aria-label={`Send ${org.name} a court inquiry`}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full bg-lime px-4 text-xs font-bold text-primary-foreground hover:opacity-90"
            >
              Inquire about a court
            </button>
          )}
        </div>
      </div>

      <CourtInquiryDialog
        orgId={org.id}
        orgName={org.name}
        open={inquiryOpen}
        onOpenChange={setInquiryOpen}
      />
    </section>
  );
}
