import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { pageHead, ogImageUrl } from "@/lib/seo";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  ArrowLeft,
  ShieldCheck,
  MapPin,
  Star,
  Trophy,
  Calendar,
  Award,
  DollarSign,
  Share2,
  Sparkles,
  MessageCircle,
  Pencil,
  GraduationCap,
  CheckCircle2,
} from "lucide-react";
import { GAMES, type Org } from "@/lib/sample-data";
import { ensureOrgById, isMyOrg } from "@/lib/org-store";
import { GameCard } from "@/components/GameCard";
import { ReviewsSection } from "@/components/ReviewsSection";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { ReputationBadge } from "@/components/ReputationBadge";
import { useCanReview } from "@/lib/transactions";
import { BookSessionSheet, type BookPrefill } from "@/components/BookSessionSheet";
import { TrainerAvailabilityMonth } from "@/components/TrainerAvailabilityMonth";
import { NextAvailableList } from "@/components/NextAvailableList";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrainerOrgForTrainer } from "@/lib/trainer-orgs.functions";
import { TrainerOrgSection } from "@/components/TrainerOrgSection";
import { TrainerProfileChecklist } from "@/components/TrainerProfileChecklist";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hideFinishedGames } from "@/lib/game-time";
import { ProfileShareCard } from "@/components/ProfileShareCard";

export const Route = createFileRoute("/trainers/$trainerId/")({
  validateSearch: zodValidator(
    z.object({
      tab: fallback(z.string(), "").default(""),
      modal: fallback(z.string(), "").default(""),
      venue: fallback(z.string(), "").default(""),
    }),
  ),

  head: ({ loaderData, params }) => {
    const o = loaderData as Org | undefined;
    const name = o?.name ?? "Trainer";
    return pageHead({
      path: `/trainers/${params.trainerId}`,
      title: `${name} — Trainer on ballaCity`,
      description: (
        o?.bio ||
        o?.tagline ||
        `Book sessions with ${name} on ballaCity: session types, venues, and availability.`
      ).slice(0, 155),
      image: ogImageUrl({
        kind: "trainer",
        title: name,
        subtitle: o?.tagline ?? o?.city ?? "Trainer on ballaCity",
        meta: [o?.sports?.[0], o?.city, "Book a session"],
      }),
      noindex: !o,
      jsonLd: o
        ? {
            "@context": "https://schema.org",
            "@type": "Person",
            name: o.name,
            jobTitle: "Coach",
            address: o.city ?? undefined,
            url: `https://open-run-connect.lovable.app/trainers/${params.trainerId}`,
          }
        : undefined,
    });
  },
  loader: async ({ params }) => {
    const org = await ensureOrgById(params.trainerId);
    if (!org) throw notFound();
    if (org.kind !== "coach") {
      throw redirect({ to: "/teams/$teamId", params: { teamId: org.id }, replace: true });
    }
    return org;
  },
  component: TrainerPage,
  errorComponent: () => (
    <div className="page-shell-content pt-24 text-center">
      <p className="text-muted-foreground">Couldn't load this trainer.</p>
      <Link
        to="/trainers"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Trainers
      </Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="page-shell-content pt-24 text-center">
      <p className="text-muted-foreground">Trainer not found.</p>
      <Link
        to="/trainers"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Trainers
      </Link>
    </div>
  ),
});

function TrainerPage() {
  const org = Route.useLoaderData() as Org;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const tab: "about" | "experience" | "reviews" =
    search.tab === "experience" || search.tab === "reviews" ? search.tab : "about";
  const reviewsOpen = search.modal === "reviews";
  const selectedVenue: string = search.venue || "";
  const setTab = (v: "about" | "experience" | "reviews") =>
    navigate({ to: ".", search: { ...search, tab: v === "about" ? "" : v }, replace: true });
  const setReviewsOpen = (v: boolean) =>
    navigate({ to: ".", search: { ...search, modal: v ? "reviews" : "" }, replace: true });
  const setSelectedVenue = (v: string) =>
    navigate({
      to: ".",
      search: { ...search, venue: selectedVenue === v ? "" : v },
      replace: true,
    });

  const [bookOpen, setBookOpen] = useState(false);
  const [bookPrefill, setBookPrefill] = useState<BookPrefill | null>(null);
  const [following, setFollowing] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canEdit = mounted && isMyOrg(org.id);

  const qc = useQueryClient();
  const orgLinkQuery = useQuery({
    queryKey: ["trainer-org-for-trainer", org.id],
    queryFn: () => getTrainerOrgForTrainer({ data: { trainerId: org.id } }),
  });
  const linkedOrg = orgLinkQuery.data?.org ?? null;

  // Realtime: reflect newly-approved memberships or org changes immediately.
  useEffect(() => {
    const ch = supabase
      .channel(`trainer-org-link:${org.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trainer_org_members",
          filter: `trainer_id=eq.${org.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["trainer-org-for-trainer", org.id] });
          qc.invalidateQueries({ queryKey: ["trainer-org-memberships", org.id] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trainer_org_join_requests",
          filter: `trainer_id=eq.${org.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["trainer-org-for-trainer", org.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [org.id, qc]);

  const [shareOpen, setShareOpen] = useState(false);
  const orgReviews = useReviewsFor(org.id);
  const orgRep = useMemo(() => computeReputation(orgReviews, "trainer"), [orgReviews]);

  const hostedGames = useMemo(
    () => hideFinishedGames(GAMES.filter((g) => org.upcoming.includes(g.id))),
    [org.upcoming],
  );

  const specialties = useMemo(() => {
    const set = new Set<string>();
    org.sports.forEach((s) => set.add(s));
    (org.sessionTypes ?? []).forEach((s) => set.add(s));
    return Array.from(set);
  }, [org.sports, org.sessionTypes]);

  return (
    <div className="page-shell-flush pb-40">
      {/* Cover */}
      <div className="relative h-56">
        <img src={org.cover} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/30 to-background" />
        <Link
          to="/trainers"
          search={selectedVenue ? ({ venue: selectedVenue } as never) : undefined}
          className="absolute top-4 left-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
          aria-label="Back to trainers"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <button
          onClick={() => setShareOpen(true)}
          className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
          aria-label="Share trainer profile"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      <ProfileShareCard
        open={shareOpen}
        onOpenChange={setShareOpen}
        data={{
          kind: "trainer",
          path: `/trainers/${org.id}`,
          displayName: org.name,
          username: org.handle,
          initials: org.name.slice(0, 2).toUpperCase(),
          bio: org.bio || org.tagline || undefined,
          city: org.city || undefined,
          sports: (org.sports ?? []).map((s) => ({ name: s })),
          trustScore: orgRep.count ? orgRep.trustScore : undefined,
          reviewCount: orgRep.count,
          extras: [org.ratePerHour ? `$${org.ratePerHour}/hr` : null],
        }}
      />

      <div className="px-4 -mt-14 relative">
        {/* Identity */}
        <div className="flex items-end justify-between gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -8 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 16 }}
            className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-3xl border-4 border-background font-display text-3xl font-bold text-primary-foreground"
            style={{
              background: `linear-gradient(135deg, ${org.accent}, ${org.accent}aa)`,
              boxShadow: `0 12px 40px -10px ${org.accent}88`,
            }}
          >
            {(() => {
              const av = (org.avatar ?? "").trim();
              const isImg = /^(https?:\/\/|\/|data:)/i.test(av);
              if (isImg) {
                return (
                  <img
                    src={av}
                    alt={org.name}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                );
              }
              return av || (org.name?.slice(0, 2).toUpperCase() ?? "OR");
            })()}
          </motion.div>

          <div className="mb-2 flex items-center gap-2">
            {canEdit && (
              <Link
                to="/trainers/$trainerId/edit"
                params={{ trainerId: org.id }}
                className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5 hover:border-lime/40"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            )}
            {useCanReview(org.id) && (
              <Link
                to="/review/new"
                search={
                  {
                    revieweeId: org.id,
                    revieweeKind: "trainer",
                    revieweeName: org.name,
                    kind: "player",
                  } as any
                }
                className="rounded-full border border-lime/40 bg-lime/10 px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5 text-lime"
              >
                <Star className="h-3.5 w-3.5" /> Review
              </Link>
            )}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setFollowing((f) => !f)}
              data-render="ssr-stable"
              className={`rounded-full px-5 py-2.5 text-sm font-bold transition-all ${
                following
                  ? "border border-border bg-surface text-foreground"
                  : "bg-lime-gradient text-primary-foreground glow-lime"
              }`}
            >
              {following ? "Following ✓" : "Follow"}
            </motion.button>
          </div>
        </div>

        <div className="mt-3">
          <h1 className="page-title flex items-center gap-2">
            {org.name}
            <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
              <GraduationCap className="h-3 w-3" /> Trainer
            </span>
            {org.verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                <ShieldCheck className="h-3 w-3" /> Verified
              </span>
            )}
          </h1>
          <div className="mt-0.5 text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>{org.handle}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {org.city}
            </span>
            <span>·</span>
            <span>Since {org.founded}</span>
          </div>
          <p className="mt-2 text-sm text-foreground/90">{org.tagline}</p>
          {linkedOrg && (
            <Link
              to="/orgs/$orgId"
              params={{ orgId: linkedOrg.id }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-medium text-foreground hover:border-lime/60 hover:text-lime"
            >
              <Building2 className="h-3.5 w-3.5" />
              at {linkedOrg.name}
              {linkedOrg.verified ? " ✓" : ""}
            </Link>
          )}
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Stat
            label="Rating"
            value={org.rating ? `${org.rating.toFixed(1)}★` : "—"}
            icon={<Star className="h-3.5 w-3.5 text-coral" />}
          />
          <Stat
            label="Rate"
            value={org.ratePerHour ? `$${org.ratePerHour}/hr` : "—"}
            icon={<DollarSign className="h-3.5 w-3.5 text-lime" />}
          />
          <Stat
            label="Sessions"
            value={String(hostedGames.length)}
            icon={<Trophy className="h-3.5 w-3.5 text-lime" />}
          />
        </div>

        {orgRep.count > 0 && (
          <div className="mt-4">
            <ReputationBadge
              rep={orgRep}
              onClick={() => setReviewsOpen(true)}
              ariaLabel={`Open reviews for ${org.name}. Trust score ${orgRep.trustScore}, ${orgRep.avg.toFixed(1)} out of 5 from ${orgRep.count} review${orgRep.count === 1 ? "" : "s"}.`}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 flex gap-1 rounded-full border border-border bg-surface p-1">
          {(["about", "experience", "reviews"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full px-2 py-2 text-xs font-semibold capitalize transition-all ${
                tab === t ? "bg-lime text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {t === "experience"
                ? `Experience · ${hostedGames.length}`
                : t === "reviews"
                  ? `Reviews · ${orgRep.count}`
                  : "About"}
            </button>
          ))}
        </div>

        {/* About */}
        {tab === "about" && (
          <div className="mt-5 space-y-5">
            {canEdit && <TrainerProfileChecklist org={org} />}
            {canEdit && <TrainerOrgSection trainerId={org.id} />}
            <Section title="Bio">
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {org.bio}
              </p>
            </Section>

            {specialties.length > 0 && (
              <Section
                title={
                  <>
                    <Sparkles className="h-4 w-4" /> Specialties
                  </>
                }
              >
                <div className="flex flex-wrap gap-2">
                  {specialties.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {org.credentials && org.credentials.length > 0 && (
              <Section
                title={
                  <>
                    <ShieldCheck className="h-4 w-4" /> Credentials
                  </>
                }
              >
                <ul className="space-y-1.5">
                  {org.credentials.map((c) => (
                    <li
                      key={c}
                      className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 text-lime shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {org.ratePerHour ? (
              <Section
                title={
                  <>
                    <DollarSign className="h-4 w-4" /> Rate
                  </>
                }
              >
                <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
                  <div className="font-display text-xl font-bold">
                    ${org.ratePerHour}
                    <span className="text-sm font-normal text-muted-foreground"> / hour</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Final pricing confirmed in your booking request.
                  </div>
                </div>
              </Section>
            ) : null}

            <Section
              title={
                <>
                  <MapPin className="h-4 w-4" /> Based in
                </>
              }
            >
              <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
                {org.city}
              </div>
            </Section>
          </div>
        )}

        {/* Experience */}
        {tab === "experience" && (
          <div className="mt-5 space-y-5">
            {org.achievements && org.achievements.length > 0 && (
              <Section
                title={
                  <>
                    <Award className="h-4 w-4" /> Achievements
                  </>
                }
              >
                <ul className="space-y-1.5">
                  {org.achievements.map((a) => (
                    <li
                      key={a}
                      className="rounded-2xl border border-border bg-surface px-3 py-2 text-sm"
                    >
                      🏆 {a}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {org.venueAddresses && org.venueAddresses.length > 0 && (
              <Section
                title={
                  <>
                    <MapPin className="h-4 w-4" /> Session venues
                  </>
                }
              >
                {org.venueAddresses.length > 1 && (
                  <div className="-mx-1 mb-2 overflow-x-auto px-1">
                    <div className="flex gap-2 pb-1">
                      <button
                        type="button"
                        onClick={() => setSelectedVenue("")}
                        className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          !selectedVenue
                            ? "border-lime bg-lime text-primary-foreground"
                            : "border-border bg-surface text-muted-foreground"
                        }`}
                      >
                        All venues
                      </button>
                      {[...org.venueAddresses]
                        .sort((a, b) => {
                          const pv = org.primaryVenue?.trim();
                          if (!pv) return 0;
                          if (a.trim() === pv) return -1;
                          if (b.trim() === pv) return 1;
                          return 0;
                        })
                        .map((addr) => {
                          const active =
                            selectedVenue.trim().toLowerCase() === addr.trim().toLowerCase();
                          const isPrimary =
                            !!org.primaryVenue && addr.trim() === org.primaryVenue.trim();
                          const short = addr.split(",")[0];
                          return (
                            <button
                              key={addr}
                              type="button"
                              onClick={() => setSelectedVenue(addr)}
                              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                active
                                  ? "border-lime bg-lime text-primary-foreground"
                                  : "border-border bg-surface text-muted-foreground"
                              }`}
                            >
                              {isPrimary ? "★ " : ""}
                              {short}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
                <ul className="space-y-1.5">
                  {[...org.venueAddresses]
                    .sort((a, b) => {
                      const pv = org.primaryVenue?.trim();
                      if (!pv) return 0;
                      if (a.trim() === pv) return -1;
                      if (b.trim() === pv) return 1;
                      return 0;
                    })
                    .map((addr, i) => {
                      const isPrimary =
                        !!org.primaryVenue && addr.trim() === org.primaryVenue.trim();
                      const dimmed =
                        selectedVenue &&
                        selectedVenue.trim().toLowerCase() !== addr.trim().toLowerCase();
                      const focused =
                        selectedVenue &&
                        selectedVenue.trim().toLowerCase() === addr.trim().toLowerCase();
                      return (
                        <li
                          key={i}
                          className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-sm transition-opacity ${
                            focused ? "border-lime bg-lime/10" : "border-border bg-surface"
                          } ${dimmed ? "opacity-40" : ""}`}
                        >
                          <span className="min-w-0 truncate">{addr}</span>
                          {isPrimary && (
                            <span className="shrink-0 rounded-full border border-lime bg-lime/20 px-2 py-0.5 micro-label text-lime">
                              ★ Primary
                            </span>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </Section>
            )}

            {((org.availabilitySlots?.length ?? 0) > 0 ||
              (org.availabilityOverrides?.length ?? 0) > 0 ||
              (org.availabilityRules?.length ?? 0) > 0) && (
              <Section
                title={
                  <>
                    <Calendar className="h-4 w-4" /> Availability
                    {selectedVenue && (
                      <span className="ml-2 rounded-full border border-lime/50 bg-lime/10 px-2 py-0.5 micro-label text-lime">
                        {selectedVenue.split(",")[0]}
                      </span>
                    )}
                  </>
                }
              >
                <div className="mb-3">
                  <NextAvailableList
                    org={org}
                    venueFilter={selectedVenue || null}
                    onPick={(s) => {
                      setBookPrefill({
                        date: s.dateKey,
                        startTime: s.trainerStart ?? s.start,
                        venue: s.venue ?? null,
                      });
                      setBookOpen(true);
                    }}
                  />
                </div>
                <TrainerAvailabilityMonth
                  weekly={org.availabilitySlots ?? []}
                  overrides={org.availabilityOverrides ?? []}
                  rules={org.availabilityRules ?? []}
                  primaryVenue={org.primaryVenue ?? null}
                  venueFilter={selectedVenue || null}
                  trainerTz={org.timezone ?? null}
                />
              </Section>
            )}

            <Section
              title={
                <>
                  <Calendar className="h-4 w-4" /> Verified sessions
                </>
              }
            >
              {hostedGames.length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
                  No sessions on the schedule yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {hostedGames.map((g, i) => (
                    <div key={g.id} className="relative">
                      <span className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 rounded-full bg-background/80 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-lime border border-lime/40">
                        <ShieldCheck className="h-3 w-3" /> Verified host
                      </span>
                      <GameCard game={g} index={i} />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}

        {/* Reviews */}
        {tab === "reviews" && (
          <div className="mt-5">
            <ReviewsSection
              revieweeId={org.id}
              revieweeKind="trainer"
              revieweeName={org.name}
              isOwner={canEdit}
            />
          </div>
        )}
      </div>

      {/* Sticky CTA bar */}
      {!canEdit && (
        <div className="fixed inset-x-0 bottom-16 z-30 pointer-events-none px-4">
          <div className="page-shell-flush">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/85 backdrop-blur-xl p-2 shadow-2xl">
              <Link
                to="/messages"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
              >
                <MessageCircle className="h-4 w-4" /> Message
              </Link>
              <button
                onClick={() => {
                  const venueOffered =
                    !!selectedVenue &&
                    (org.venueAddresses ?? []).some(
                      (a) => a.trim().toLowerCase() === selectedVenue.trim().toLowerCase(),
                    );
                  setBookPrefill(venueOffered ? { venue: selectedVenue } : null);
                  setBookOpen(true);
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime"
              >
                <Calendar className="h-4 w-4" /> Book session
              </button>
            </div>
          </div>
        </div>
      )}

      <BookSessionSheet
        org={org}
        open={bookOpen}
        onOpenChange={(v) => {
          setBookOpen(v);
          if (!v) setBookPrefill(null);
        }}
        prefill={bookPrefill}
      />

      <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-xl"
          aria-labelledby="trainer-reviews-title"
          aria-describedby="trainer-reviews-desc"
        >
          <DialogHeader className="sr-only">
            <DialogTitle id="trainer-reviews-title">Reviews for {org.name}</DialogTitle>
            <DialogDescription id="trainer-reviews-desc">
              Browse, filter, and sort reviews left for this trainer. Press Escape to close.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            <ReviewsSection
              revieweeId={org.id}
              revieweeKind="trainer"
              revieweeName={org.name}
              isOwner={canEdit}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 text-center">
      <div className="font-display text-lg font-bold inline-flex items-center gap-1 justify-center">
        {icon}
        {value}
      </div>
      <div className="micro-label text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="section-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
        {title}
      </h2>
      {children}
    </div>
  );
}
