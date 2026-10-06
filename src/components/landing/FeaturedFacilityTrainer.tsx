import { Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Dumbbell, MapPin, Star } from "lucide-react";

/**
 * Illustrative profile for the "For gyms & facilities" landing section. It is
 * sample content, not a real trainer: the card says so, and its buttons go to
 * real pages (browse trainers / create a trainer profile) rather than to a
 * booking sheet that nobody could answer.
 */
export const FEATURED_FACILITY_TRAINER = {
  name: "Coach Jordan Kim",
  initials: "JK",
  role: "Resident Trainer",
  facility: "Bogan Park Sports Complex",
  city: "Williamsburg, NY",
  rating: 4.9,
  reviews: 86,
  ratePerHour: 75,
  specialties: ["Shooting & Footwork", "Speed & Agility", "Private 1-on-1", "Clinics"],
  blurb: "Running weekly shooting labs and private athlete development out of Court 2.",
  availability: "Booking now · Slots available this week",
} as const;

export function FeaturedFacilityTrainer() {
  const t = FEATURED_FACILITY_TRAINER;
  return (
    <article
      aria-label="Example partner trainer"
      className="mt-6 rounded-2xl border border-lime/30 bg-background/40 p-5 md:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-lime">
          <Dumbbell className="h-4 w-4" /> Partner trainer spotlight
        </p>
        <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          Example profile
        </span>
      </div>

      <div className="mt-4 flex items-start gap-4">
        <div
          aria-hidden
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-lime-gradient font-display text-lg font-bold text-primary-foreground"
        >
          {t.initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-x-2 font-display text-xl font-bold">
            {t.name}
            <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
              <BadgeCheck className="h-3.5 w-3.5" /> Verified
            </span>
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.role} · <span className="font-semibold text-foreground">{t.facility}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {t.rating.toFixed(1)}{" "}
              <span className="font-normal text-muted-foreground">({t.reviews} reviews)</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {t.city}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-2xl font-bold leading-none">
            ${t.ratePerHour}
            <span className="text-sm font-semibold text-muted-foreground"> / hr</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Paid to the trainer directly</div>
        </div>
      </div>

      <ul aria-label="Specialties" className="mt-4 flex flex-wrap gap-2">
        {t.specialties.map((s) => (
          <li
            key={s}
            className="rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-xs font-semibold text-lime"
          >
            {s}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm italic text-foreground/85">&ldquo;{t.blurb}&rdquo;</p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="h-2 w-2 rounded-full bg-lime" /> {t.availability}
        </span>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        A sample profile showing how a trainer and a facility connect on ballaCity.
      </p>
    </article>
  );
}
