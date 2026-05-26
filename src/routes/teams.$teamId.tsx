import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  ArrowLeft, ShieldCheck, MapPin, Users, Star, Trophy, Calendar,
  Award, DollarSign, Share2, Plus, Pencil,
} from "lucide-react";
import { ORGS, GAMES, POST_KIND_META, type PostKind, type Org } from "@/lib/sample-data";
import { isMyOrg } from "@/lib/org-store";
import { PostCard } from "@/components/PostCard";
import { GameCard } from "@/components/GameCard";
import { ReviewsSection } from "@/components/ReviewsSection";

export const Route = createFileRoute("/teams/$teamId")({
  head: ({ params }) => {
    const o = ORGS.find((x) => x.id === params.teamId);
    return { meta: [{ title: o ? `${o.name} — OpenRun` : "Team — OpenRun" }] };
  },
  component: TeamPage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md px-6 pt-24 text-center">
      <p className="text-muted-foreground">Team not found.</p>
      <Link to="/teams" className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground">
        Back to Teams
      </Link>
    </div>
  ),
  loader: ({ params }) => {
    const org = ORGS.find((o) => o.id === params.teamId);
    if (!org) throw notFound();
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
  const [filter, setFilter] = useState<PostKind | "all">("all");
  const [tab, setTab] = useState<"posts" | "about" | "games" | "reviews">("posts");
  const [following, setFollowing] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canEdit = mounted && isMyOrg(org.id);

  const posts = org.posts.filter((p) => (filter === "all" ? true : p.kind === filter));
  const upcomingGames = GAMES.filter((g) => org.upcoming.includes(g.id));

  return (
    <div className="mx-auto max-w-md pb-32">
      {/* Cover */}
      <div className="relative h-56">
        <img src={org.cover} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/30 to-background" />
        <Link to="/teams" className="absolute top-4 left-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <button className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur">
          <Share2 className="h-4 w-4" />
        </button>
      </div>

        <div className="px-4 -mt-14 relative">
        {/* Identity */}
        <div className="flex items-end justify-between gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -8 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 16 }}
            className="grid h-24 w-24 place-items-center rounded-3xl border-4 border-background font-display text-3xl font-bold text-primary-foreground"
            style={{ background: `linear-gradient(135deg, ${org.accent}, ${org.accent}aa)`, boxShadow: `0 12px 40px -10px ${org.accent}88` }}
          >
            {org.avatar}
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
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setFollowing((f) => !f)}
              data-render="ssr-stable"
              className={`rounded-full px-5 py-2.5 text-sm font-bold transition-all ${
                following ? "border border-border bg-surface text-foreground" : "bg-lime-gradient text-primary-foreground glow-lime"
              }`}
            >
              {following ? "Following ✓" : "Follow"}
            </motion.button>
          </div>
        </div>

        <div className="mt-3">
          <h1 className="font-display text-2xl font-bold flex items-center gap-2 leading-tight">
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
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{org.city}</span>
            <span>·</span>
            <span>Est. {org.founded}</span>
          </div>
          <p className="mt-2 text-sm text-foreground/90">{org.tagline}</p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {org.sports.map((s) => (
              <span key={s} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">{s}</span>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Stat label="Followers" value={org.followers.toLocaleString()} icon={<Users className="h-3.5 w-3.5 text-lime" />} />
          {org.kind === "team" ? (
            <>
              <Stat label="Roster" value={String(org.roster)} icon={<Users className="h-3.5 w-3.5 text-lime" />} />
              <Stat label="Record" value={`${org.record!.w}–${org.record!.l}`} icon={<Trophy className="h-3.5 w-3.5 text-coral" />} />
            </>
          ) : (
            <>
              <Stat label="Rating" value={`${org.rating!.toFixed(1)}★`} icon={<Star className="h-3.5 w-3.5 text-coral" />} />
              <Stat label="Rate" value={`$${org.ratePerHour}/hr`} icon={<DollarSign className="h-3.5 w-3.5 text-lime" />} />
            </>
          )}
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1 rounded-full border border-border bg-surface p-1">
          {(["posts", "about", "games"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold capitalize transition-all ${
                tab === t ? "bg-lime text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {t === "games" ? `Games · ${upcomingGames.length}` : t === "posts" ? `Posts · ${org.posts.length}` : "About"}
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
              <button className="shrink-0 inline-flex items-center gap-1 rounded-full bg-coral-gradient px-3 py-2 text-xs font-bold text-white glow-coral">
                <Plus className="h-3.5 w-3.5" /> Post
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {posts.map((p, i) => <PostCard key={p.id} post={p} index={i} />)}
              {posts.length === 0 && (
                <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
                  No {POST_KIND_META[filter as PostKind]?.label.toLowerCase() ?? "posts"} yet.
                </div>
              )}
            </div>
          </>
        )}

        {/* About tab */}
        {tab === "about" && (
          <div className="mt-5 space-y-5">
            <Section title="Bio">
              <p className="text-sm text-foreground/90 leading-relaxed">{org.bio}</p>
            </Section>

            <Section title={<><Award className="h-4 w-4" /> Achievements</>}>
              <ul className="space-y-1.5">
                {org.achievements.map((a) => (
                  <li key={a} className="rounded-2xl border border-border bg-surface px-3 py-2 text-sm">
                    🏆 {a}
                  </li>
                ))}
              </ul>
            </Section>

            {org.kind === "coach" && org.credentials && (
              <Section title="Credentials">
                <div className="flex flex-wrap gap-2">
                  {org.credentials.map((c) => (
                    <span key={c} className="rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime">
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
                    <div className="text-muted-foreground text-xs mt-0.5">Home: {org.homeCourt}</div>
                  </div>
                </Section>
                {org.staff && (
                  <Section title="Staff & captains">
                    <div className="space-y-2">
                      {org.staff.map((s) => (
                        <div key={s.name} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
                          {s.avatar.startsWith("data:") ? (
                            <img src={s.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
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

            <Section title={<><Calendar className="h-4 w-4" /> Founded</>}>
              <p className="text-sm text-muted-foreground">Active on OpenRun since {org.founded}.</p>
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
            {upcomingGames.map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 text-center">
      <div className="font-display text-lg font-bold inline-flex items-center gap-1 justify-center">
        {icon}{value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
        {title}
      </h2>
      {children}
    </div>
  );
}
