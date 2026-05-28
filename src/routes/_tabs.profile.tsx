import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Settings, Trophy, Calendar, Video, Shield, Users, Plus, BarChart3 } from "lucide-react";
import { ME, GAMES } from "@/lib/sample-data";
import { GameCard } from "@/components/GameCard";
import { OrgCard } from "@/components/OrgCard";
import { ReviewsSection } from "@/components/ReviewsSection";
import { useMyOrgs } from "@/lib/org-store";
import { HERO_IMAGE } from "@/lib/sample-data";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { ReputationBadge } from "@/components/ReputationBadge";
import { useMemo } from "react";

export const Route = createFileRoute("/_tabs/profile")({
  head: () => ({ meta: [{ title: "Profile — OpenRun" }] }),
  component: Profile,
});

function Profile() {
  const myOrgs = useMyOrgs();
  const myReviews = useReviewsFor("me");
  const myRep = useMemo(() => computeReputation(myReviews, "player"), [myReviews]);
  return (
    <div className="mx-auto max-w-md">
      {/* Cover */}
      <div className="relative h-44">
        <img src={HERO_IMAGE} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background" />
        <button className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur">
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Identity */}
      <div className="px-4 -mt-12 relative">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 16 }}
          className="grid h-24 w-24 place-items-center rounded-3xl border-4 border-background bg-lime-gradient font-display text-3xl font-bold text-primary-foreground glow-lime"
        >
          {ME.avatar}
        </motion.div>
        <div className="mt-3 flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              {ME.name}
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                <Shield className="h-3 w-3" /> Verified
              </span>
            </h1>
            <div className="text-sm text-muted-foreground">{ME.username} · {ME.city}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-foreground/90">{ME.bio}</p>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {[
            { k: ME.stats.played, v: "Games" },
            { k: ME.stats.reliability + "%", v: "Reliable" },
            { k: ME.stats.sportsmanship, v: "Sport" },
            { k: ME.stats.friends, v: "Crew" },
          ].map((s) => (
            <div key={s.v} className="rounded-2xl border border-border bg-surface p-3 text-center">
              <div className="font-display text-lg font-bold">{s.k}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </div>

        {/* Sports & skill */}
        <div className="mt-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Sports</h2>
          <div className="space-y-2">
            {ME.sports.map((s) => (
              <div key={s.name} className="rounded-2xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-lime font-bold">{s.skill.toFixed(1)} / 5</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.skill / 5) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-lime-gradient"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Badges */}
        <div className="mt-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Trophy className="h-4 w-4" /> Badges
          </h2>
          <div className="flex flex-wrap gap-2">
            {ME.badges.map((b) => (
              <span key={b} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold">
                {b}
              </span>
            ))}
          </div>
        </div>

        {/* My organizations */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="h-4 w-4" /> My organizations
            </h2>
            <Link to="/teams/create" className="inline-flex items-center gap-1 text-xs font-bold text-lime">
              <Plus className="h-3.5 w-3.5" /> New
            </Link>
          </div>
          {myOrgs.length === 0 ? (
            <Link
              to="/teams/create"
              className="block rounded-3xl border border-dashed border-border bg-surface/40 p-5 text-center hover:border-lime/40"
            >
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-lime/15 text-lime mb-2">
                <Plus className="h-6 w-6" />
              </div>
              <div className="font-display text-base font-bold">Start a team or coach profile</div>
              <p className="text-xs text-muted-foreground mt-1">Post tryouts, run pickups, build your following.</p>
            </Link>
          ) : (
            <div className="space-y-3">
              {myOrgs.map((o, i) => <OrgCard key={o.id} org={o} index={i} />)}
            </div>
          )}
        </div>

        {/* Pro upsell */}

        <motion.div
          whileHover={{ scale: 1.01 }}
          className="mt-6 rounded-3xl border border-coral/40 bg-coral-gradient p-5 text-white relative overflow-hidden"
        >
          <Video className="absolute right-4 top-4 h-16 w-16 opacity-10" />
          <div className="text-xs font-bold uppercase tracking-wider opacity-80">OpenRun Pro</div>
          <h3 className="font-display text-xl font-bold mt-1">AI highlight reels, unlimited hosting.</h3>
          <p className="text-sm opacity-90 mt-1">Cinematic clips from raw gameplay. One-tap export to TikTok & Reels.</p>
          <button className="mt-3 rounded-full bg-background px-4 py-2 text-sm font-bold text-foreground">
            Upgrade · $7.99 / mo
          </button>
        </motion.div>

        {/* Reviews */}
        <ReviewsSection revieweeId="me" revieweeKind="player" revieweeName={ME.name} isOwner />

        {/* Upcoming */}
        <div className="mt-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Calendar className="h-4 w-4" /> Upcoming games
          </h2>
          <div className="space-y-3">
            {GAMES.slice(0, 2).map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
