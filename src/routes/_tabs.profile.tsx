import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Settings, Trophy, Calendar, Video, Shield, Users, Plus, BarChart3, LogIn, LogOut, CreditCard } from "lucide-react";
import { ME, GAMES } from "@/lib/sample-data";
import { GameCard } from "@/components/GameCard";
import { OrgCard } from "@/components/OrgCard";
import { ReviewsSection } from "@/components/ReviewsSection";
import { useMyOrgs } from "@/lib/org-store";
import { HERO_IMAGE } from "@/lib/sample-data";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { ReputationBadge } from "@/components/ReputationBadge";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getCurrentUser, useAuth, signOut } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useJoinedGameIds } from "@/lib/games-store";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useMyProfile } from "@/lib/user-prefs-store";
import { ProfileLinksList } from "@/components/ProfileLinks";


export const Route = createFileRoute("/_tabs/profile")({
  head: () => ({ meta: [{ title: "Profile — OpenRun" }] }),
  component: Profile,
});

function Profile() {
  const myOrgs = useMyOrgs();
  const myReviews = useReviewsFor("me");
  const myRep = useMemo(() => computeReputation(myReviews, "player"), [myReviews]);
  const { user, loading } = useAuth();
  const [confirmedUser, setConfirmedUser] = useState<User | null>(null);
  const profileUser = user ?? confirmedUser;
  const me = useMyProfile(profileUser);
  const joinedGameIds = useJoinedGameIds();
  const hosted = useHostedGames();
  const upcomingGames = useMemo(() => {
    const ids = new Set(joinedGameIds);
    const pool = [...hosted, ...GAMES];
    const seen = new Set<string>();
    return pool
      .filter((game) => ids.has(game.id))
      .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [joinedGameIds, hosted]);

  useEffect(() => {
    if (user) setConfirmedUser(user);
  }, [user]);

  useEffect(() => {
    if (loading || profileUser || me) return;
    let cancelled = false;
    getCurrentUser().then((currentUser) => {
      if (!cancelled && currentUser) setConfirmedUser(currentUser);
      if (!cancelled && !currentUser) setConfirmedUser(null);
    });
    return () => { cancelled = true; };
  }, [loading, profileUser, me]);

  if (loading) return null;
  if (!profileUser || !me) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 pb-28 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-lime-gradient font-display text-xl font-bold text-primary-foreground glow-lime">
          O
        </div>
        <h1 className="mt-5 font-display text-3xl font-bold">Sign in to view your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your games, reviews, and profile stay private until you sign in.</p>
        <Link
          to="/auth"
          className="mt-6 inline-flex rounded-full bg-lime-gradient px-6 py-3 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }


  return (
    <div className="mx-auto max-w-md">
      {/* Cover */}
      <div className="relative h-44">
        <img src={HERO_IMAGE} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background" />
        <div className="absolute top-4 right-4 flex items-center gap-2">
          {user ? (
            <button
              onClick={async () => { await signOut(); }}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-3 py-2 text-xs font-bold backdrop-blur"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          ) : (
            <Link
              to="/auth"
              className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-3 py-2 text-xs font-bold text-primary-foreground"
            >
              <LogIn className="h-3.5 w-3.5" /> Sign in
            </Link>
          )}
          {user && (
            <Link
              to="/account/security"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-3 py-2 text-xs font-bold backdrop-blur"
            >
              <Shield className="h-3.5 w-3.5" /> Security
            </Link>
          )}
          <Link to="/profile/edit" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur" aria-label="Edit profile">
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Identity */}
      <div className="px-4 -mt-12 relative">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 16 }}
          className="grid h-24 w-24 place-items-center rounded-3xl border-4 border-background bg-lime-gradient font-display text-3xl font-bold text-primary-foreground glow-lime"
        >
          {me.avatar}
        </motion.div>
        <div className="mt-3 flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              {me.name}
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                <Shield className="h-3 w-3" /> Verified
              </span>
            </h1>
            <div className="text-sm text-muted-foreground">{me.username} · {me.city}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-foreground/90">{me.bio}</p>

        {me.links.length > 0 && (
          <div className="mt-3">
            <ProfileLinksList links={me.links} />
          </div>
        )}



        {/* Stats */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {[
            { k: me.stats.played, v: "Games" },
            { k: me.stats.reliability + "%", v: "Reliable" },
            { k: me.stats.sportsmanship, v: "Sport" },
            { k: me.stats.friends, v: "Crew" },
          ].map((s) => (
            <div key={s.v} className="rounded-2xl border border-border bg-surface p-3 text-center">
              <div className="font-display text-lg font-bold">{s.k}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </div>

        {/* Reputation badge (above the fold) */}
        <div className="mt-4">
          <ReputationBadge rep={myRep} />
        </div>

        {/* Upcoming */}
        <div className="mt-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Calendar className="h-4 w-4" /> Upcoming games
          </h2>
          {upcomingGames.length > 0 ? (
            <div className="space-y-3">
              {upcomingGames.map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
            </div>
          ) : (
            <Link
              to="/feed"
              className="block rounded-3xl border border-dashed border-border bg-surface/40 p-5 text-center hover:border-lime/40"
            >
              <div className="font-display text-base font-bold">No games joined yet</div>
              <p className="text-xs text-muted-foreground mt-1">Join a run to see it here.</p>
            </Link>
          )}
        </div>

        {/* Sports & skill */}
        <div className="mt-6">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Sports</h2>
          <div className="space-y-2">
            {me.sports.map((s) => (
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
            {me.badges.map((b) => (
              <span key={b} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold">
                {b}
              </span>
            ))}
          </div>
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

        {/* Reviews Hub link */}
        <Link
          to="/reviews"
          className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Reviews Hub</div>
            <div className="text-xs text-muted-foreground">Trust scores and AI insights across OpenRun</div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>

        <Link to="/payments" className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Payments</div>
            <div className="text-xs text-muted-foreground">Manage payout methods & verify player payments</div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>

        <Link to="/reels" className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <Video className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">AI Highlight Reels</div>
            <div className="text-xs text-muted-foreground">3 free, then $15/mo unlimited</div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>

        <Link to="/plans" className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Plans & Subscriptions</div>
            <div className="text-xs text-muted-foreground">Host, Team, Org & Reel plans</div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>


        {/* Reviews */}
        <ReviewsSection revieweeId="me" revieweeKind="player" revieweeName={me.name} isOwner />

      </div>
    </div>
  );
}
