import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Dumbbell, MapPin, Star } from "lucide-react";
import { getFeaturedFacilityTrainer } from "@/lib/trainer-orgs.functions";
import type { FeaturedTrainer } from "@/lib/featured-trainer";

/**
 * Illustrative profile shown on the landing page only while no real,
 * bookable trainer is linked to a facility. It is sample content, so the card
 * says so, and its buttons go to real pages instead of a booking sheet nobody
 * could answer.
 */
export const EXAMPLE_FACILITY_TRAINER = {
  name: "Coach Jordan Kim",
  facility: "Bogan Park Sports Complex",
  city: "Williamsburg, NY",
  rating: 4.9,
  reviewCount: 86,
  ratePerHour: 75,
  specialties: ["Shooting & Footwork", "Speed & Agility", "Private 1-on-1", "Clinics"],
  blurb: "Running weekly shooting labs and private athlete development out of Court 2.",
} as const;

function initialsOf(name: string): string {
  const parts = name
    .replace(/^(coach|trainer)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "T";
}

function Avatar({ name, avatar }: { name: string; avatar: string | null }) {
  const isUrl = !!avatar && /^(https?:|\/)/.test(avatar);
  return (
    <div
      aria-hidden
      className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-lime-gradient font-display text-lg font-bold text-primary-foreground"
    >
      {isUrl ? (
        <img src={avatar!} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </div>
  );
}

type CardProps =
  { example: true; trainer?: undefined } | { example?: false; trainer: FeaturedTrainer };

/** Presentational card: a real trainer, or the labeled example. */
export function FacilityTrainerCard(props: CardProps) {
  const live = props.example ? null : props.trainer;
  const ex = EXAMPLE_FACILITY_TRAINER;
  const name = live?.name ?? ex.name;
  const city = live ? live.city : ex.city;
  const rate = live?.ratePerHour ?? ex.ratePerHour;
  const specialties: readonly string[] = live ? live.specialties : ex.specialties;
  const blurb = live ? live.blurb : ex.blurb;
  const rating = live ? live.rating : ex.rating;
  const reviewCount = live ? live.reviewCount : ex.reviewCount;
  const verified = live ? live.verified : true;
  const facilityName = live?.facility.name ?? ex.facility;

  return (
    <article
      aria-label={live ? "Featured partner trainer" : "Example partner trainer"}
      className="mt-6 rounded-2xl border border-lime/30 bg-background/40 p-5 md:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-lime">
          <Dumbbell className="h-4 w-4" /> Partner trainer spotlight
        </p>
        {!live && (
          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            Example profile
          </span>
        )}
      </div>

      <div className="mt-4 flex items-start gap-4">
        <Avatar name={name} avatar={live?.avatar ?? null} />
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-x-2 font-display text-xl font-bold">
            {name}
            {verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified
              </span>
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            Resident Trainer ·{" "}
            {live ? (
              <Link
                to="/orgs/$orgId"
                params={{ orgId: live.facility.id }}
                className="font-semibold text-foreground hover:text-lime"
              >
                {facilityName}
              </Link>
            ) : (
              <span className="font-semibold text-foreground">{facilityName}</span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {rating != null && reviewCount > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {rating.toFixed(1)}{" "}
                <span className="font-normal text-muted-foreground">
                  ({reviewCount} review{reviewCount === 1 ? "" : "s"})
                </span>
              </span>
            ) : (
              <span>New on BallaCity</span>
            )}
            {city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {city}
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-2xl font-bold leading-none">
            ${rate}
            <span className="text-sm font-semibold text-muted-foreground"> / hr</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Paid to the trainer directly</div>
        </div>
      </div>

      {specialties.length > 0 && (
        <ul aria-label="Specialties" className="mt-4 flex flex-wrap gap-2">
          {specialties.map((s) => (
            <li
              key={s}
              className="rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-xs font-semibold text-lime"
            >
              {s}
            </li>
          ))}
        </ul>
      )}

      {blurb && <p className="mt-4 text-sm italic text-foreground/85">&ldquo;{blurb}&rdquo;</p>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="h-2 w-2 rounded-full bg-lime" />
          {live ? "Booking now · See open times" : "Booking now · Slots available this week"}
        </span>
        <div className="flex flex-wrap gap-2">
          {live ? (
            <>
              <Link
                to="/trainers"
                className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface transition-colors"
              >
                Browse all trainers
              </Link>
              <Link
                to="/trainers/$trainerId"
                params={{ trainerId: live.id }}
                className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface transition-colors"
              >
                View profile
              </Link>
              <Link
                to="/trainers/$trainerId"
                params={{ trainerId: live.id }}
                search={{ modal: "book" }}
                className="inline-flex items-center gap-1.5 rounded-full bg-lime-gradient px-4 py-2 text-sm font-bold text-primary-foreground hover:scale-[1.02] transition-transform"
              >
                Book session <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/trainers"
                className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface transition-colors"
              >
                Browse all trainers
              </Link>
              <Link
                to="/trainers/create"
                className="inline-flex items-center gap-1.5 rounded-full bg-lime-gradient px-4 py-2 text-sm font-bold text-primary-foreground hover:scale-[1.02] transition-transform"
              >
                Become a resident trainer <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>
      </div>
      {!live && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          A sample profile showing how a trainer and a facility connect on BallaCity.
        </p>
      )}
    </article>
  );
}

/**
 * Landing-page spotlight: a real bookable trainer linked to a facility when
 * one exists, otherwise the labeled example. Renders nothing while loading so
 * the example never flashes before a real trainer replaces it.
 */
export function FeaturedFacilityTrainer() {
  const q = useQuery({
    queryKey: ["featured-facility-trainer"],
    queryFn: () => getFeaturedFacilityTrainer(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (q.isPending) return null;
  return q.data ? <FacilityTrainerCard trainer={q.data} /> : <FacilityTrainerCard example />;
}
