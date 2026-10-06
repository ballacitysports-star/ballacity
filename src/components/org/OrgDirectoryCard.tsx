import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarPlus, ExternalLink, MapPin, ShieldCheck } from "lucide-react";
import { ResponsiveImage } from "@/components/ResponsiveImage";
import { CourtInquiryDialog } from "@/components/org/CourtInquiryDialog";
import { describeOpenBadge, parseHours, type OpenBadge } from "@/lib/org-hours";
import { highlightAmenities, websiteHref } from "@/lib/org-listing";

export type OrgDirectoryRow = {
  id: string;
  name: string;
  handle: string;
  avatar: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  photos: string[] | null;
  city: string | null;
  address: string | null;
  bio: string | null;
  category: string | null;
  amenities: string[] | null;
  hours: unknown;
  timezone: string | null;
  website: string | null;
  verified: boolean | null;
};

const BADGE_TEXT: Record<OpenBadge["tone"], string> = {
  open: "text-lime",
  closing: "text-amber-500",
  closed: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

// Distinguishes rentals, studios and complexes at a glance.
function categoryTone(category: string): string {
  if (/rental/i.test(category)) return "bg-sky-500/15 text-sky-400";
  if (/complex|fieldhouse|recreation/i.test(category)) return "bg-violet-500/15 text-violet-400";
  if (/studio|training/i.test(category)) return "bg-coral/15 text-coral";
  return "bg-lime/15 text-lime";
}

/** Facility card for the /orgs directory: photos, live hours, tags, Book court. */
export function OrgDirectoryCard({ org, now }: { org: OrgDirectoryRow; now: Date }) {
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const photos = [org.cover_url, ...(org.photos ?? [])].filter(Boolean) as string[];
  const hero = photos[0] ?? null;
  const thumbs = photos.slice(1, 4);
  const badge = describeOpenBadge(parseHours(org.hours), org.timezone, now);
  const { tags, more } = highlightAmenities(org.amenities);
  const bookingUrl = websiteHref(org.website);
  const place = [org.address, org.city].filter(Boolean).join(" · ") || null;

  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-lime/40">
      <Link to="/orgs/$orgId" params={{ orgId: org.id }} className="block">
        <div className="relative aspect-[16/9] bg-secondary/40">
          {hero ? (
            <ResponsiveImage
              src={hero}
              alt={`${org.name} courts`}
              aspect={16 / 9}
              widths={[320, 480, 640, 960]}
              sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
              baseWidth={640}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-lime-gradient">
              {org.avatar_url ? (
                <img
                  src={org.avatar_url}
                  alt=""
                  className="h-16 w-16 rounded-2xl border-2 border-background/40 object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="font-display text-4xl font-bold text-primary-foreground/90"
                >
                  {org.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
          )}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            {org.category ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur ${categoryTone(org.category)}`}
              >
                {org.category}
              </span>
            ) : (
              <span />
            )}
            <span
              className={`inline-flex max-w-[62%] items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[11px] backdrop-blur ${BADGE_TEXT[badge.tone]}`}
            >
              <span className="shrink-0 font-bold">{badge.headline}</span>
              {badge.detail && (
                <span className="truncate font-medium text-foreground/80">{badge.detail}</span>
              )}
            </span>
          </div>
          {photos.length > 1 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-semibold backdrop-blur">
              {photos.length} photos
            </span>
          )}
        </div>
        {thumbs.length > 0 && (
          <div className="grid grid-cols-3 gap-0.5">
            {thumbs.map((src) => (
              <ResponsiveImage
                key={src}
                src={src}
                alt=""
                aspect={16 / 9}
                widths={[160, 320]}
                sizes="120px"
                baseWidth={320}
                className="h-14 w-full object-cover"
              />
            ))}
          </div>
        )}

        <div className="space-y-2 p-3">
          <div>
            <h2 className="flex items-center gap-1.5 font-display text-base font-bold">
              <span className="truncate">{org.name}</span>
              {org.verified && (
                <ShieldCheck className="h-4 w-4 shrink-0 text-lime" aria-label="Verified" />
              )}
            </h2>
            <div className="truncate text-xs text-muted-foreground">@{org.handle}</div>
            {place && (
              <div className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-lime" />
                <span className="line-clamp-1">{place}</span>
              </div>
            )}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                  {t}
                </span>
              ))}
              {more > 0 && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                  +{more}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      <div className="flex items-center gap-2 px-3 pb-3">
        {bookingUrl ? (
          <>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-gradient px-4 py-2.5 text-sm font-bold text-primary-foreground glow-lime"
            >
              <ExternalLink className="h-4 w-4" /> Book court
            </a>
            <button
              type="button"
              onClick={() => setInquiryOpen(true)}
              className="rounded-full border border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:border-lime/60 hover:text-foreground"
            >
              Send inquiry
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setInquiryOpen(true)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-gradient px-4 py-2.5 text-sm font-bold text-primary-foreground glow-lime"
          >
            <CalendarPlus className="h-4 w-4" /> Book court
          </button>
        )}
      </div>

      {inquiryOpen && (
        <CourtInquiryDialog
          orgId={org.id}
          orgName={org.name}
          open={inquiryOpen}
          onOpenChange={setInquiryOpen}
        />
      )}
    </li>
  );
}
