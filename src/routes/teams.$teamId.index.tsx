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
  Users,
  Star,
  Trophy,
  Calendar,
  Award,
  DollarSign,
  Share2,
  Plus,
  Pencil,
  Settings,
} from "lucide-react";
import {
  ORGS,
  GAMES,
  POST_KIND_META,
  type PostKind,
  type Org,
  type OrgPost,
} from "@/lib/sample-data";
import { isMyOrg, ensureOrgById, isOrgUnclaimed } from "@/lib/org-store";
import { TeamRosterPanel } from "@/components/team/TeamRosterPanel";
import { GuardianTeamContactAction } from "@/components/team/GuardianTeamContactAction";
import { TeamEventAvailabilityCard } from "@/components/team/TeamEventAvailabilityCard";
import { useTeamPermissions } from "@/lib/team-roster";
import { SignTeamWaiverCard } from "@/components/team/SignTeamWaiverCard";
import { ClaimListingCard } from "@/components/listings/ClaimListingCard";
import { ProfileShareCard } from "@/components/ProfileShareCard";
import { PostCard } from "@/components/PostCard";
import { PostDetailsDialog } from "@/components/PostDetailsDialog";

import { GameCard } from "@/components/GameCard";
import { ReviewsSection } from "@/components/ReviewsSection";
import { computeReputation } from "@/lib/reviews";
import { useReviewsFor } from "@/lib/reviews-db";
import { ReputationBadge } from "@/components/ReputationBadge";
import { useCanReview } from "@/lib/transactions";
import { CreatePostSheet } from "@/components/CreatePostSheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTeamPosts, deleteTeamPost } from "@/lib/team-posts.functions";
import { Trash2 } from "lucide-react";
import { hideFinishedGames } from "@/lib/game-time";
import { OrgAvatarMark } from "@/components/OrgAvatarMark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/teams/$teamId/")({
  head: ({ loaderData, params }) => {
    const o = (loaderData ?? ORGS.find((x) => x.id === params.teamId)) as Org | undefined;
    const name = o?.name ?? "Team";
    return pageHead({
      path: `/teams/${params.teamId}`,
      title: `${name} | BallaCity Sports Team`,
      description: (
        o?.bio ||
        o?.tagline ||
        `Follow ${name} on BallaCity: roster, games, tryouts, and reviews.`
      ).slice(0, 155),
      image: ogImageUrl({
        kind: "team",
        title: name,
        subtitle: o?.tagline ?? o?.city ?? "Team on BallaCity",
        meta: [o?.sports?.[0], o?.city, "Roster & games"],
      }),
      jsonLd: o
        ? {
            "@context": "https://schema.org",
            "@type": "SportsTeam",
            name: o.name,
            sport: o.sports?.join(", "),
            address: o.city ?? undefined,
            url: `https://ballacity.com/teams/${params.teamId}`,
          }
        : undefined,
    });
  },
  // URL-persisted view: active tab (posts/about/games), post-kind filter,
  // and reviews modal. Refreshing or sharing the URL restores the same view.
  validateSearch: zodValidator(
    z.object({
      tab: fallback(z.string(), "").default(""),
      filter: fallback(z.string(), "").default(""),
      modal: fallback(z.string(), "").default(""),
    }),
  ),
  component: TeamPage,
  errorComponent: () => (
    <div className="page-shell-content pt-24 text-center">
      <p className="text-muted-foreground">Couldn't load this team.</p>
      <Link
        to="/teams"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Teams
      </Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="page-shell-content pt-24 text-center">
      <p className="text-muted-foreground">Team not found.</p>
      <Link
        to="/teams"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Teams
      </Link>
    </div>
  ),
  loader: async ({ params }) => {
    const org = await ensureOrgById(params.teamId);
    if (!org) throw notFound();
    if (org.kind === "coach") {
      throw redirect({ to: "/trainers/$trainerId", params: { trainerId: org.id }, replace: true });
    }
    return org;
  },
});

const FILTERS: { key: PostKind | "all"; label: string }[] = [
  { key: "all", label: "All posts" },
  { key: "tryout", label: "🎯 Tryouts" },
  { key: "pickup", label: "🏃 Pickups" },
  { key: "clinic", label: "🧠 Clinics" },
  { key: "announcement", label: "📣 News" },
];

function TeamPage() {
  const org = Route.useLoaderData() as Org;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: "posts" | "roster" | "about" | "games" =
    search.tab === "about" || search.tab === "games" || search.tab === "roster"
      ? search.tab
      : "posts";
  const filter: PostKind | "all" = (search.filter || "all") as PostKind | "all";
  const reviewsOpen = search.modal === "reviews";
  const setTab = (v: "posts" | "roster" | "about" | "games") =>
    navigate({ to: ".", search: { ...search, tab: v === "posts" ? "" : v }, replace: true });
  const setFilter = (v: PostKind | "all") =>
    navigate({ to: ".", search: { ...search, filter: v === "all" ? "" : v }, replace: true });
  const setReviewsOpen = (v: boolean) =>
    navigate({ to: ".", search: { ...search, modal: v ? "reviews" : "" }, replace: true });
  const [following, setFollowing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [openPost, setOpenPost] = useState<OrgPost | null>(null);

  useEffect(() => setMounted(true), []);
  const canEdit = mounted && isMyOrg(org.id);
  // Editing the team row is owner-only in RLS; managing the roster is not.
  const teamPerms = useTeamPermissions(org.id);
  const isUnclaimed = mounted && isOrgUnclaimed(org.id);
  const canManage = mounted && teamPerms.canInvite;

  const orgReviews = useReviewsFor(org.id);
  const orgKind: "trainer" | "team" = org.kind === "coach" ? "trainer" : "team";
  const orgRep = useMemo(() => computeReputation(orgReviews, orgKind), [orgReviews, orgKind]);

  const qc = useQueryClient();
  const listFn = useServerFn(listTeamPosts);
  const deleteFn = useServerFn(deleteTeamPost);
  const postsQuery = useQuery({
    queryKey: ["team-posts", org.id],
    queryFn: () => listFn({ data: { teamId: org.id } }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-posts", org.id] }),
  });
  const allPosts: OrgPost[] = useMemo(
    () =>
      (postsQuery.data ?? []).map((r: any) => ({
        id: String(r.id),
        kind: r.kind as PostKind,
        title: r.title,
        body: r.body ?? "",
        date: r.event_date ?? r.created_at,
        postedAt: r.created_at,
        location: r.location ?? undefined,
        price: r.price ?? undefined,
        spots:
          typeof r.spots_max === "number"
            ? { taken: r.spots_taken ?? 0, max: r.spots_max }
            : undefined,
        pinned: !!r.pinned,
      })),
    [postsQuery.data],
  );
  const posts = allPosts.filter((p) => (filter === "all" ? true : p.kind === filter));
  const upcomingGames = hideFinishedGames(GAMES.filter((g) => org.upcoming.includes(g.id)));

  return (
    <div className="page-shell-flush pb-32">
      {/* Cover */}
      <div className="relative h-56">
        <img src={org.cover} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/30 to-background" />
        <Link
          to="/teams"
          className="absolute top-4 left-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <button className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur">
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 -mt-14 relative">
        {isUnclaimed && (
          <div className="mb-4">
            <ClaimListingCard subjectType="team" subjectId={org.id} name={org.name} />
          </div>
        )}
        {/* Identity */}
        <div className="flex items-end justify-between gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -8 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 16 }}
            className="grid h-24 w-24 place-items-center overflow-hidden rounded-3xl border-4 border-background font-display text-3xl font-bold text-primary-foreground"
            style={{
              background: `linear-gradient(135deg, ${org.accent}, ${org.accent}aa)`,
              boxShadow: `0 12px 40px -10px ${org.accent}88`,
            }}
          >
            <OrgAvatarMark avatar={org.avatar} fallback={org.name.slice(0, 2).toUpperCase()} />
          </motion.div>
          <div className="mb-2 flex items-center gap-2">
            {canEdit && (
              <Link
                to="/teams/$teamId/edit"
                params={{ teamId: org.id }}
                data-render="client-only"
                className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5 hover:border-lime/40"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            )}
            {canManage && (
              <Link
                to="/teams/$teamId/manage"
                params={{ teamId: org.id }}
                data-render="client-only"
                className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5 hover:border-lime/40"
              >
                <Settings className="h-3.5 w-3.5" /> Manage
              </Link>
            )}
            <GuardianTeamContactAction teamId={org.id} />
            {useCanReview(org.id) && (
              <Link
                to="/review/new"
                search={
                  {
                    revieweeId: org.id,
                    revieweeKind: org.kind === "coach" ? "trainer" : "team",
                    revieweeName: org.name,
                    kind: "player",
                  } as any
                }
                className="rounded-full border border-lime/40 bg-lime/10 px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5 text-lime"
              >
                <Star className="h-3.5 w-3.5" /> Write review
              </Link>
            )}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              data-render="ssr-stable"
              className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5 hover:border-lime/40"
            >
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
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

        <ProfileShareCard
          open={shareOpen}
          onOpenChange={setShareOpen}
          data={{
            kind: orgKind === "trainer" ? "trainer" : "team",
            path: `/teams/${org.id}`,
            displayName: org.name,
            username: org.handle,
            initials: org.name.slice(0, 2).toUpperCase(),
            bio: org.bio || org.tagline || undefined,
            city: org.city || undefined,
            sports: (org.sports ?? []).map((s) => ({ name: s })),
            trustScore: orgRep.count ? orgRep.trustScore : undefined,
            reviewCount: orgRep.count,
            extras: [
              org.followers ? `${org.followers.toLocaleString()} followers` : null,
              org.founded ? `Est. ${org.founded}` : null,
            ],
          }}
        />

        <div className="mt-3">
          <h1 className="page-title flex items-center gap-2">
            {org.name}
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
            <span>Est. {org.founded}</span>
          </div>
          <p className="mt-2 text-sm text-foreground/90">{org.tagline}</p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {org.sports.map((s) => (
              <span key={s} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
                {s}
              </span>
            ))}
            {org.skillRange && (
              <span className="rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-xs font-semibold text-lime">
                {
                  ["Beginner", "Recreational", "Intermediate", "Advanced", "Pro"][
                    org.skillRange.min - 1
                  ]
                }
                {org.skillRange.min !== org.skillRange.max &&
                  ` – ${["Beginner", "Recreational", "Intermediate", "Advanced", "Pro"][org.skillRange.max - 1]}`}
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Stat
            label="Followers"
            value={org.followers.toLocaleString()}
            icon={<Users className="h-3.5 w-3.5 text-lime" />}
          />
          {org.kind === "team" ? (
            <>
              <Stat
                label="Roster"
                value={String(org.roster)}
                icon={<Users className="h-3.5 w-3.5 text-lime" />}
              />
              <Stat
                label="Record"
                value={`${org.record!.w}–${org.record!.l}`}
                icon={<Trophy className="h-3.5 w-3.5 text-coral" />}
              />
            </>
          ) : (
            <>
              <Stat
                label="Rating"
                value={`${org.rating!.toFixed(1)}★`}
                icon={<Star className="h-3.5 w-3.5 text-coral" />}
              />
              <Stat
                label="Rate"
                value={`$${org.ratePerHour}/hr`}
                icon={<DollarSign className="h-3.5 w-3.5 text-lime" />}
              />
            </>
          )}
        </div>

        {/* Reputation badge (opens reviews popup) */}
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
          {(["posts", "roster", "about", "games"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full px-2 py-2 text-xs font-semibold capitalize transition-all ${
                tab === t ? "bg-lime text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {t === "games"
                ? `Games · ${upcomingGames.length}`
                : t === "posts"
                  ? `Posts · ${allPosts.length}`
                  : t === "roster"
                    ? "Roster"
                    : "About"}
            </button>
          ))}
        </div>

        {/* Posts tab */}
        {tab === "posts" && (
          <>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide flex-1 -mx-4 px-4 pb-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      filter === f.key
                        ? "border-lime bg-lime text-primary-foreground"
                        : "border-border bg-surface text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {canEdit && (
                <button
                  onClick={() => setComposerOpen(true)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full bg-coral-gradient px-3 py-2 text-xs font-bold text-white glow-coral"
                >
                  <Plus className="h-3.5 w-3.5" /> Post
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {postsQuery.isLoading && (
                <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
                  Loading posts…
                </div>
              )}
              {!postsQuery.isLoading &&
                posts.map((p, i) => (
                  <div key={p.id} className="relative">
                    <PostCard post={p} index={i} onClick={() => setOpenPost(p)} />
                    {canEdit && (
                      <button
                        onClick={() => {
                          if (confirm("Delete this post?")) {
                            deleteMutation.mutate({ data: { id: p.id } });
                          }
                        }}
                        aria-label="Delete post"
                        className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full border border-border bg-background/80 text-muted-foreground hover:text-coral"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              {!postsQuery.isLoading && posts.length === 0 && (
                <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
                  No {POST_KIND_META[filter as PostKind]?.label.toLowerCase() ?? "posts"} yet.
                </div>
              )}
            </div>
          </>
        )}

        {/* Roster tab */}
        {tab === "roster" && (
          <>
            <SignTeamWaiverCard teamId={org.id} teamName={org.name} />
            <TeamEventAvailabilityCard teamId={org.id} />
            <TeamRosterPanel teamId={org.id} teamName={org.name} />
          </>
        )}

        {/* About tab */}
        {tab === "about" && (
          <div className="mt-5 space-y-5">
            <Section title="Bio">
              <p className="text-sm text-foreground/90 leading-relaxed">{org.bio}</p>
            </Section>

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

            {org.kind === "coach" && org.credentials && (
              <Section title="Credentials">
                <div className="flex flex-wrap gap-2">
                  {org.credentials.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {org.kind === "team" && (
              <>
                <Section title="League">
                  <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
                    <div className="font-semibold">{org.league}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">
                      Home: {org.homeCourt}
                    </div>
                  </div>
                </Section>
                {org.staff && (
                  <Section title="Staff & captains">
                    <div className="space-y-2">
                      {org.staff.map((s) => (
                        <div
                          key={s.name}
                          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
                        >
                          {s.avatar.startsWith("data:") ? (
                            <img
                              src={s.avatar}
                              alt=""
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">
                              {s.avatar}
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-semibold">{s.name}</div>
                            <div className="text-xs text-muted-foreground">{s.role}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </>
            )}

            <Section
              title={
                <>
                  <Calendar className="h-4 w-4" /> Founded
                </>
              }
            >
              <p className="text-sm text-muted-foreground">
                Active on BallaCity since {org.founded}.
              </p>
            </Section>
          </div>
        )}

        {/* Games tab */}
        {tab === "games" && (
          <div className="mt-5 space-y-3">
            {upcomingGames.length === 0 && (
              <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
                No upcoming games scheduled.
              </div>
            )}
            {upcomingGames.map((g, i) => (
              <GameCard key={g.id} game={g} index={i} />
            ))}
          </div>
        )}

        {/* Reviews popup */}
        <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
          <DialogContent
            className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-xl"
            aria-labelledby="team-reviews-title"
            aria-describedby="team-reviews-desc"
          >
            <DialogHeader className="sr-only">
              <DialogTitle id="team-reviews-title">Reviews for {org.name}</DialogTitle>
              <DialogDescription id="team-reviews-desc">
                Browse, filter, and sort reviews left for this{" "}
                {org.kind === "coach" ? "trainer" : "team"}. Press Escape to close.
              </DialogDescription>
            </DialogHeader>
            <div className="p-4">
              <ReviewsSection
                revieweeId={org.id}
                revieweeKind={org.kind === "coach" ? "trainer" : "team"}
                revieweeName={org.name}
                isOwner={canEdit}
              />
            </div>
          </DialogContent>
        </Dialog>

        {canEdit && (
          <CreatePostSheet teamId={org.id} open={composerOpen} onOpenChange={setComposerOpen} />
        )}
      </div>
      <PostDetailsDialog
        post={openPost}
        team={{ id: org.id, name: org.name, sport: org.sports?.[0] }}
        open={!!openPost}
        onOpenChange={(o) => !o && setOpenPost(null)}
      />
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
