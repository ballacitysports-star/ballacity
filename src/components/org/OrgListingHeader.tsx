import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  MapPin,
  Users,
  ShieldCheck,
  Crown,
  Clock,
  Phone,
  Globe,
  Navigation,
  Share2,
  Mail,
  ChevronDown,
  Star,
  CalendarPlus,
  ExternalLink,
} from "lucide-react";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import {
  WEEKDAYS,
  dayHours,
  formatDayHours,
  hasAnyHours,
  localNow,
  parseHours,
  resolveOpenState,
} from "@/lib/org-hours";
import { bookingHref, directionsHref, emailHref, telHref, websiteHref } from "@/lib/org-listing";
import { CourtInquiryDialog } from "@/components/org/CourtInquiryDialog";
import { ResponsiveAvatar, ResponsiveImage } from "@/components/ResponsiveImage";
import { ProfileShareCard } from "@/components/ProfileShareCard";

export type OrgListingRow = {
  id: string;
  name: string;
  handle: string;
  bio: string | null;
  city: string | null;
  website: string | null;
  booking_url?: string | null;
  avatar: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  verified: boolean | null;
  address?: string | null;
  place_id?: string | null;
  geo?: { lat?: number; lng?: number } | null;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  amenities?: string[] | null;
  photos?: string[] | null;
  hours?: unknown;
  timezone?: string | null;
};

function ActionButton({
  icon: Icon,
  label,
  href,
  onClick,
}: {
  icon: typeof Phone;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const cls =
    "flex flex-1 min-w-[4.5rem] flex-col items-center gap-1 rounded-xl border border-border bg-background px-2 py-2 text-[11px] font-semibold text-foreground hover:border-lime/60";
  const inner = (
    <>
      <Icon className="h-4 w-4 text-lime" />
      {label}
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** Google-listing style header for the public gym page. */
export function OrgListingHeader({
  org,
  memberCount,
  isAdmin,
  isOwner,
  rating,
  reviewCount,
  children,
}: {
  org: OrgListingRow;
  memberCount: number;
  isAdmin: boolean;
  isOwner: boolean;
  rating?: number | null;
  reviewCount?: number;
  children?: React.ReactNode;
}) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    setAvatarFailed(false);
  }, [org.avatar_url]);

  const hours = parseHours(org.hours);
  const open = resolveOpenState(hours, org.timezone);
  const photos = [org.cover_url, ...(org.photos ?? [])].filter(Boolean) as string[];
  const geo = org.geo ?? null;
  const today = localNow(org.timezone).day;

  const directions = directionsHref({
    address: org.address,
    placeId: org.place_id,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
  });
  const tel = telHref(org.phone);
  const site = websiteHref(org.website);
  const mail = emailHref(org.email);
  const book = bookingHref(org);

  return (
    <>
      <ProfileShareCard
        open={shareOpen}
        onOpenChange={setShareOpen}
        data={{
          kind: "gym",
          path: `/orgs/${org.id}`,
          displayName: org.name,
          username: `@${org.handle}`,
          initials: org.name.slice(0, 2).toUpperCase(),
          avatarUrl: org.avatar_url ?? undefined,
          bio: org.bio ?? undefined,
          city: org.city ?? org.address ?? undefined,
          rating: rating ?? null,
          reviewCount: reviewCount,
          extras: [
            org.category,
            `${memberCount} trainer${memberCount === 1 ? "" : "s"}`,
            hasAnyHours(hours) ? (open.status === "open" ? "Open now" : "Closed") : null,
          ],
        }}
      />
      {inquiryOpen && (
        <CourtInquiryDialog
          orgId={org.id}
          orgName={org.name}
          open={inquiryOpen}
          onOpenChange={setInquiryOpen}
        />
      )}
      <header className="overflow-hidden rounded-2xl border border-border/60 bg-surface">
        {photos.length > 0 ? (
          <div className="flex gap-1 overflow-x-auto">
            {photos.map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setLightbox(i)}
                className={`${i === 0 ? "w-2/3" : "w-1/3"} h-40 shrink-0 sm:h-56`}
              >
                <ResponsiveImage
                  src={src}
                  alt={`${org.name} photo ${i + 1}`}
                  widths={[320, 480, 640, 960]}
                  sizes="(min-width: 640px) 60vw, 66vw"
                  baseWidth={640}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        ) : null}

        {lightbox !== null && photos[lightbox] && (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-background/95 p-4"
            onClick={() => setLightbox(null)}
            role="presentation"
          >
            <ResponsiveImage
              src={photos[lightbox]}
              alt={`${org.name} photo ${lightbox + 1}`}
              sizes="100vw"
              baseWidth={1280}
              loading="eager"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain"
            />
          </div>
        )}

        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-lime/15 text-2xl">
              {org.avatar_url && !avatarFailed ? (
                <ResponsiveAvatar
                  src={org.avatar_url}
                  size={56}
                  alt=""
                  className="h-full w-full object-cover"
                  onLoadError={() => setAvatarFailed(true)}
                />
              ) : org.avatar ? (
                <span>{org.avatar}</span>
              ) : (
                <Building2 className="h-6 w-6 text-lime" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-bold flex items-center gap-2 flex-wrap">
                {org.name}
                {org.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                    <ShieldCheck className="h-3 w-3" /> Verified
                  </span>
                )}
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">
                    <Crown className="h-3 w-3" /> {isOwner ? "Owner" : "Admin"}
                  </span>
                )}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {typeof rating === "number" && rating > 0 && (
                  <a
                    href="#gym-reviews"
                    className="inline-flex items-center gap-1 font-semibold text-foreground"
                  >
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {rating.toFixed(1)}
                    {reviewCount ? ` (${reviewCount})` : ""}
                  </a>
                )}
                {org.category && (
                  <span className="font-semibold text-foreground">{org.category}</span>
                )}
                <span>@{org.handle}</span>
                {org.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {org.city}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {memberCount} trainer
                  {memberCount === 1 ? "" : "s"}
                </span>
              </div>
              {hasAnyHours(hours) && (
                <div className="mt-1 text-sm">
                  <span
                    className={
                      open.status === "open"
                        ? open.closingSoon
                          ? "font-bold text-amber-500"
                          : "font-bold text-lime"
                        : "font-bold text-muted-foreground"
                    }
                  >
                    {open.status === "open" ? "Open now" : "Closed"}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {open.label.replace(/^(Open|Closed) · /, "")}
                  </span>
                </div>
              )}
            </div>
            {isAdmin && (
              <div className="flex shrink-0 flex-col gap-2">
                <Link
                  to="/orgs/$orgId/edit"
                  params={{ orgId: org.id }}
                  className="rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-center text-xs font-bold text-lime hover:bg-lime/20"
                >
                  Edit
                </Link>
                <Link
                  to="/orgs/$orgId/members"
                  params={{ orgId: org.id }}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-center text-xs font-semibold hover:bg-secondary/60"
                >
                  Manage members
                </Link>
              </div>
            )}
          </div>

          {!isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {book ? (
                <>
                  <a
                    href={book}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-gradient px-5 py-3 text-sm font-bold text-primary-foreground glow-lime"
                  >
                    <ExternalLink className="h-4 w-4" /> Book court
                  </a>
                  <button
                    type="button"
                    onClick={() => setInquiryOpen(true)}
                    className="rounded-full border border-border px-4 py-3 text-xs font-semibold text-muted-foreground hover:border-lime/60 hover:text-foreground"
                  >
                    Send inquiry
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setInquiryOpen(true)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-gradient px-5 py-3 text-sm font-bold text-primary-foreground glow-lime"
                >
                  <CalendarPlus className="h-4 w-4" /> Book court
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {directions && <ActionButton icon={Navigation} label="Directions" href={directions} />}
            {tel && <ActionButton icon={Phone} label="Call" href={tel} />}
            {site && <ActionButton icon={Globe} label="Website" href={site} />}
            {mail && <ActionButton icon={Mail} label="Email" href={mail} />}
            <ActionButton icon={Share2} label="Share" onClick={() => setShareOpen(true)} />
          </div>

          <div className="divide-y divide-border/60 rounded-2xl border border-border/60">
            {org.address && (
              <div className="flex items-start gap-2 px-3 py-2.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
                <span className="min-w-0">{org.address}</span>
              </div>
            )}
            {hasAnyHours(hours) && (
              <div className="px-3 py-2.5 text-sm">
                <button
                  type="button"
                  onClick={() => setHoursOpen((v) => !v)}
                  className="flex w-full items-center gap-2 text-left"
                  aria-expanded={hoursOpen}
                >
                  <Clock className="h-4 w-4 shrink-0 text-lime" />
                  <span className="min-w-0 flex-1">
                    {WEEKDAYS[today]}: {formatDayHours(dayHours(hours, today))}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${hoursOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {hoursOpen && (
                  <ul className="mt-2 space-y-1 pl-6 text-xs">
                    {WEEKDAYS.map((label, d) => (
                      <li
                        key={label}
                        className={`flex justify-between gap-3 ${d === today ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                      >
                        <span>{label}</span>
                        <span>{formatDayHours(dayHours(hours, d))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {tel && (
              <a
                href={tel}
                className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary/40"
              >
                <Phone className="h-4 w-4 shrink-0 text-lime" /> {org.phone}
              </a>
            )}
            {site && (
              <a
                href={site}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary/40"
              >
                <Globe className="h-4 w-4 shrink-0 text-lime" />
                <span className="min-w-0 truncate text-lime">{org.website}</span>
              </a>
            )}
            {mail && (
              <a
                href={mail}
                className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary/40"
              >
                <Mail className="h-4 w-4 shrink-0 text-lime" /> {org.email}
              </a>
            )}
          </div>

          {geo && typeof geo.lat === "number" && typeof geo.lng === "number" && (
            <div className="overflow-hidden rounded-2xl border border-border">
              <VenueMapPreview
                address={org.address ?? org.name}
                lat={geo.lat}
                lng={geo.lng}
                placeId={org.place_id ?? undefined}
              />
            </div>
          )}

          {(org.amenities?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {org.amenities!.map((a) => (
                <span key={a} className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                  {a}
                </span>
              ))}
            </div>
          )}

          {org.bio && (
            <div>
              <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                About
              </h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{org.bio}</p>
            </div>
          )}

          {children}
        </div>
      </header>
    </>
  );
}
