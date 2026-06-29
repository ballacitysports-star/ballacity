import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Settings, Trophy, Calendar, Shield, LogIn, LogOut, Clock, Check, X as XIcon } from "lucide-react";
import { ME, GAMES } from "@/lib/sample-data";
import { GameCard } from "@/components/GameCard";
import { ReviewsSection } from "@/components/ReviewsSection";
import { HERO_IMAGE } from "@/lib/sample-data";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { ReputationBadge } from "@/components/ReputationBadge";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getCurrentUser, useAuth, signOut } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useJoinedGameIds } from "@/lib/games-store";
import { useHostedGames } from "@/lib/hosted-games-store";
import { readOverrides, useMyProfile } from "@/lib/user-prefs-store";
import { ProfileLinksList } from "@/components/ProfileLinks";
import { listMyJoinRequests, cancelMyJoinRequest, type JoinRequest } from "@/lib/payments";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/_tabs/profile")({
  head: () => ({ meta: [{ title: "Profile — OpenRun" }] }),
  component: Profile,
});

function Profile() {
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
      .filter((game) => ids.has(game.id) || (profileUser && (game as { hostUserId?: string }).hostUserId === profileUser.id))
      .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [joinedGameIds, hosted, profileUser]);

  // Pending / recently-reviewed join requests for player view
  const [myRequests, setMyRequests] = useState<JoinRequest[]>([]);
  const refreshRequests = async () => {
    if (!profileUser) { setMyRequests([]); return; }
    try { setMyRequests(await listMyJoinRequests()); } catch { /* ignore */ }
  };
  useEffect(() => { refreshRequests(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [profileUser?.id]);
  useEffect(() => {
    if (!profileUser) return;
    const ch = supabase
      .channel(`profile-join-requests-${profileUser.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "join_requests", filter: `player_id=eq.${profileUser.id}` }, () => refreshRequests())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUser?.id]);

  const gameLookup = useMemo(() => {
    const m = new Map<string, { title: string; date: string; location: string }>();
    [...hosted, ...GAMES].forEach((g) => { if (!m.has(g.id)) m.set(g.id, { title: g.title, date: g.date, location: g.location }); });
    return m;
  }, [hosted]);

  const pendingRequests = myRequests.filter((r) => r.status === "pending");
  const recentlyReviewed = myRequests.filter((r) => r.status !== "pending").slice(0, 3);

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

  // Sync locally stored profile overrides up to the server profiles row,
  // so other users can see this user's avatar, cover, city, bio, and external links.
  useEffect(() => {
    if (!profileUser || !me) return;
    const key = `openrun.profileSync.v1.${profileUser.id}`;
    if (typeof window === "undefined") return;
    const local = readOverrides(profileUser.id);
    const hasLocalData = ["name", "username", "avatar", "bio", "city", "avatarUrl", "coverUrl", "links"].some((field) =>
      Object.prototype.hasOwnProperty.call(local, field),
    );
    if (!hasLocalData) return;
    const payload = {
      id: profileUser.id,
      display_name: local.name ?? me.name,
      username: (local.username ?? me.username).replace(/^@/, "") || null,
      avatar_initials: local.avatar ?? me.avatar,
      bio: (local.bio ?? me.bio) || null,
      city: (local.city ?? me.city) || null,
      avatar_url: local.avatarUrl ?? me.avatarUrl ?? null,
      cover_url: local.coverUrl ?? me.coverUrl ?? null,
      links: Array.isArray(local.links) ? local.links : (me.links ?? []),
    };
    const signature = JSON.stringify(payload);
    if (window.localStorage.getItem(key) === signature) return;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase
          .from("profiles")
          .upsert(payload as any, { onConflict: "id" });
        if (!cancelled && !error) window.localStorage.setItem(key, signature);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [profileUser, me]);

  if (loading) return null;
  if (!profileUser || !me) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md sm:max-w-2xl lg:max-w-4xl flex-col items-center justify-center px-6 pb-28 text-center">
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
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl">
      {/* Cover */}
      <div className="relative h-44">
        <img src={me.coverUrl ?? HERO_IMAGE} alt="" className="h-full w-full object-cover" />
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
          className="grid h-24 w-24 place-items-center overflow-hidden rounded-3xl border-4 border-background bg-lime-gradient font-display text-3xl font-bold text-primary-foreground glow-lime"
        >
          {me.avatarUrl ? (
            <img src={me.avatarUrl} alt={me.name} className="h-full w-full object-cover" />
          ) : (
            me.avatar
          )}
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
            {(me.birthday || me.graduatingClass) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {me.birthday && (
                  <span>🎂 {formatBirthday(me.birthday)}{ageFrom(me.birthday) != null ? ` · ${ageFrom(me.birthday)} yrs` : ""}</span>
                )}
                {me.graduatingClass && <span>🎓 Class of {me.graduatingClass}</span>}
              </div>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm text-foreground/90">{me.bio}</p>

        {me.links && me.links.length > 0 && (
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

        {/* Join request status (pending approvals + recent decisions) */}
        {(pendingRequests.length > 0 || recentlyReviewed.length > 0) && (
          <div className="mt-6">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> Pending approvals
              {pendingRequests.length > 0 && (
                <span className="ml-1 rounded-full bg-coral/15 px-2 py-0.5 text-[10px] font-bold text-coral">
                  {pendingRequests.length}
                </span>
              )}
            </h2>
            <div className="space-y-2">
              {pendingRequests.map((r) => {
                const g = gameLookup.get(r.game_id);
                return (
                  <div key={r.id} className="rounded-2xl border border-coral/40 bg-coral/10 p-3 flex items-start gap-3">
                    <Clock className="h-4 w-4 text-coral shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/games/$gameId"
                        params={{ gameId: r.game_id }}
                        className="font-semibold text-sm hover:text-lime hover:underline truncate block"
                      >
                        {g?.title ?? "Pickup game"}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Waiting for host approval · {new Date(r.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await cancelMyJoinRequest(r.game_id);
                          toast("Request canceled.");
                          refreshRequests();
                        } catch (e: any) { toast.error(e.message ?? "Could not cancel."); }
                      }}
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold hover:border-coral/40"
                    >
                      Cancel
                    </button>
                  </div>
                );
              })}
              {recentlyReviewed.map((r) => {
                const g = gameLookup.get(r.game_id);
                const approved = r.status === "approved";
                return (
                  <Link
                    key={r.id}
                    to="/games/$gameId"
                    params={{ gameId: r.game_id }}
                    className={`rounded-2xl border p-3 flex items-start gap-3 ${
                      approved ? "border-lime/40 bg-lime/10" : "border-border bg-surface"
                    }`}
                  >
                    {approved ? (
                      <Check className="h-4 w-4 text-lime shrink-0 mt-0.5" />
                    ) : (
                      <XIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{g?.title ?? "Pickup game"}</div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {approved ? "Approved — you're on the roster." : "Declined by host."}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

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






        {/* Reviews */}
        <ReviewsSection revieweeId="me" revieweeKind="player" revieweeName={me.name} isOwner />

      </div>
    </div>
  );
}

function formatBirthday(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ageFrom(iso: string): number | null {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}
