import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  Settings,
  Trophy,
  Shield,
  LogIn,
  LogOut,
  Clock,
  Star,
  Crown,
  Users,
  Grid3x3,
  Bookmark,
  Inbox,
  UserSquare2,
} from "lucide-react";
import { useFollow } from "@/lib/follows";
import { FollowSheet } from "@/components/FollowSheet";
import { ME, GAMES, type Game } from "@/lib/sample-data";
import { GameCard } from "@/components/GameCard";
import { RequestGameCard } from "@/components/RequestGameCard";
import { RequestGameCardSkeleton } from "@/components/RequestGameCardSkeleton";
import { EmptyRequestsState } from "@/components/EmptyRequestsState";
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
import {
  listMyJoinRequests,
  listHostJoinRequests,
  cancelMyJoinRequest,
  withdrawMyApprovedJoinRequest,
  reviewJoinRequest,
  type JoinRequest,
} from "@/lib/payments";
import { leaveGame } from "@/lib/games-store";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_tabs/profile")({
  head: () => ({ meta: [{ title: "Profile — OpenRun" }] }),
  // URL-persisted requests filter (all/host/player).
  validateSearch: zodValidator(
    z.object({ req: fallback(z.string(), "").default("") }),
  ),
  component: Profile,
});

function Profile() {
  const myReviews = useReviewsFor("me");
  const myRep = useMemo(() => computeReputation(myReviews, "player"), [myReviews]);
  const { user, loading } = useAuth();
  const [confirmedUser, setConfirmedUser] = useState<User | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [followList, setFollowList] = useState<null | "followers" | "following">(null);
  const [activeTab, setActiveTab] = useState<"games" | "hosting" | "requests" | "reviews">("games");
  const profileUser = user ?? confirmedUser;
  const me = useMyProfile(profileUser);
  const follow = useFollow(profileUser?.id ?? "");
  const joinedGameIds = useJoinedGameIds();
  const hosted = useHostedGames();
  const upcomingGroups = useMemo(() => {
    const ids = new Set(joinedGameIds);
    const pool = [...hosted, ...GAMES];
    const seen = new Set<string>();
    const relevant = pool
      .filter(
        (game) =>
          ids.has(game.id) ||
          (profileUser && (game as { hostUserId?: string }).hostUserId === profileUser.id),
      )
      .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
    const hosting = relevant.filter(
      (g) => profileUser && (g as { hostUserId?: string }).hostUserId === profileUser.id,
    );
    const playing = relevant.filter(
      (g) => !(profileUser && (g as { hostUserId?: string }).hostUserId === profileUser.id),
    );
    return { hosting, playing, total: relevant.length };
  }, [joinedGameIds, hosted, profileUser]);


  // Pending / recently-reviewed join requests for player and host views
  const [myRequests, setMyRequests] = useState<JoinRequest[]>([]);
  const [hostRequests, setHostRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const search = Route.useSearch();
  const profileNav = useNavigate({ from: "/profile" });
  const requestFilter: "all" | "host" | "player" =
    search.req === "host" || search.req === "player" ? search.req : "all";
  const setRequestFilter = (v: "all" | "host" | "player") =>
    profileNav({ search: (p: any) => ({ ...p, req: v === "all" ? "" : v }), replace: true });
  const refreshRequests = async (opts: { silent?: boolean } = {}) => {
    if (!profileUser) {
      setMyRequests([]);
      setHostRequests([]);
      return;
    }
    if (!opts.silent) setRequestsLoading(true);
    try {
      const [mine, hosted] = await Promise.all([
        listMyJoinRequests(),
        listHostJoinRequests(),
      ]);
      setMyRequests(mine);
      setHostRequests(hosted);
    } catch {
      /* ignore */
    } finally {
      if (!opts.silent) setRequestsLoading(false);
    }
  };
  useEffect(() => {
    refreshRequests(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [profileUser?.id]);
  useEffect(() => {
    if (!profileUser) return;
    const applyPayload = (
      payload: { eventType: string; new: any; old: any },
      bucket: "mine" | "host",
    ) => {
      const setter = bucket === "mine" ? setMyRequests : setHostRequests;
      setter((prev) => {
        if (payload.eventType === "DELETE") {
          return prev.filter((r) => r.id !== payload.old?.id);
        }
        const row = payload.new as JoinRequest;
        if (!row) return prev;
        const idx = prev.findIndex((r) => r.id === row.id);
        if (idx === -1) return [row, ...prev];
        const next = prev.slice();
        next[idx] = { ...next[idx], ...row };
        return next;
      });
    };
    const ch = supabase
      .channel(`profile-join-requests-${profileUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "join_requests",
          filter: `player_id=eq.${profileUser.id}`,
        },
        (payload) => {
          applyPayload(payload as any, "mine");
          refreshRequests({ silent: true });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "join_requests",
          filter: `host_id=eq.${profileUser.id}`,
        },
        (payload) => {
          applyPayload(payload as any, "host");
          refreshRequests({ silent: true });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUser?.id]);


  const gameLookup = useMemo(() => {
    const m = new Map<string, Game>();
    [...hosted, ...GAMES].forEach((g) => {
      if (!m.has(g.id)) m.set(g.id, g);
    });
    return m;
  }, [hosted]);

  const allRequests = useMemo(() => [...myRequests, ...hostRequests], [myRequests, hostRequests]);
  const filteredRequests = useMemo(() => {
    if (requestFilter === "all") return allRequests;
    if (requestFilter === "host") return hostRequests;
    return myRequests;
  }, [requestFilter, allRequests, hostRequests, myRequests]);
  const pendingRequests = filteredRequests.filter((r) => r.status === "pending");
  const recentlyReviewed = filteredRequests.filter((r) => r.status !== "pending").slice(0, 3);
  const pendingWithGame = pendingRequests.filter((r) => gameLookup.has(r.game_id));
  const reviewedWithGame = recentlyReviewed.filter((r) => gameLookup.has(r.game_id));

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
    return () => {
      cancelled = true;
    };
  }, [loading, profileUser, me]);

  // Sync locally stored profile overrides up to the server profiles row,
  // so other users can see this user's avatar, cover, city, bio, and external links.
  useEffect(() => {
    if (!profileUser || !me) return;
    const key = `openrun.profileSync.v1.${profileUser.id}`;
    if (typeof window === "undefined") return;
    const local = readOverrides(profileUser.id);
    const hasLocalData = [
      "name",
      "username",
      "avatar",
      "bio",
      "city",
      "avatarUrl",
      "coverUrl",
      "links",
      "birthday",
      "graduatingClass",
    ].some((field) => Object.prototype.hasOwnProperty.call(local, field));
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
      birthday: local.birthday ?? me.birthday ?? null,
      graduating_class: local.graduatingClass ?? me.graduatingClass ?? null,
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
    return () => {
      cancelled = true;
    };
  }, [profileUser, me]);

  if (loading) return null;
  if (!profileUser || !me) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md sm:max-w-2xl lg:max-w-4xl flex-col items-center justify-center px-6 pb-28 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-lime-gradient font-display text-xl font-bold text-primary-foreground glow-lime">
          O
        </div>
        <h1 className="mt-5 font-display text-3xl font-bold">Sign in to view your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your games, reviews, and profile stay private until you sign in.
        </p>
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
              onClick={async () => {
                await signOut();
              }}
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
          <Link
            to="/profile/edit"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
            aria-label="Edit profile"
          >
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
              {me.birthday &&
                (() => {
                  const a = ageFrom(me.birthday);
                  return a != null ? (
                    <span className="text-sm font-normal text-muted-foreground">· {a}</span>
                  ) : null;
                })()}
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                <Shield className="h-3 w-3" /> Verified
              </span>
            </h1>
            <div className="text-sm text-muted-foreground">
              {me.username} · {me.city}
            </div>
            {(me.birthday || me.graduatingClass) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {me.birthday && (
                  <span>
                    🎂 {formatBirthday(me.birthday)}
                    {ageFrom(me.birthday) != null ? ` · ${ageFrom(me.birthday)} yrs` : ""}
                  </span>
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
        <div className="mt-5 grid grid-cols-5 gap-2">
          {[
            { k: me.stats.played, v: "Games" },
            { k: me.stats.reliability + "%", v: "Reliable" },
            { k: me.stats.sportsmanship, v: "Sport" },
            { k: me.stats.friends, v: "Crew" },
            { k: myRep.count, v: "Reviews" },
          ].map((s, i) => (
            <button
              key={s.v}
              type="button"
              onClick={s.v === "Reviews" ? () => setReviewsOpen(true) : undefined}
              className={`rounded-2xl border border-border bg-surface p-3 text-center transition-all hover:border-lime/40 ${
                s.v === "Reviews" ? "cursor-pointer" : ""
              }`}
            >
              <div className="font-display text-lg font-bold">{s.k}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                {s.v === "Reviews" && <Star className="h-3 w-3" />}
                {s.v}
              </div>
            </button>
          ))}
        </div>

        {/* Reputation badge (above the fold) */}
        <div className="mt-4">
          <ReputationBadge rep={myRep} onClick={() => setReviewsOpen(true)} />
        </div>

        {/* Pending approvals */}
        <section className="mt-8 rounded-3xl border border-border bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-2xl border border-coral/30 bg-coral/10 text-coral">
                <Clock className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-foreground">
                  Pending approvals
                </h2>
                <p className="text-[10px] text-muted-foreground">Join requests needing action</p>
              </div>
            </div>
            {pendingWithGame.length > 0 && !requestsLoading && (
              <span className="rounded-full bg-coral/15 px-2.5 py-1 text-[10px] font-bold text-coral">
                {pendingWithGame.length}
              </span>
            )}
          </div>
          {!requestsLoading && (
            <Tabs
              value={requestFilter}
              onValueChange={(v) => setRequestFilter(v as "all" | "host" | "player")}
              className="mb-3"
            >
              <TabsList className="h-8 w-full rounded-full bg-surface-2 p-1 border border-border">
                <TabsTrigger
                  value="all"
                  className="flex-1 rounded-full text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value="host"
                  className="flex-1 rounded-full text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  Host actions
                </TabsTrigger>
                <TabsTrigger
                  value="player"
                  className="flex-1 rounded-full text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  My sent requests
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="space-y-3">
            {requestsLoading ? (
              <>
                <RequestGameCardSkeleton />
                <RequestGameCardSkeleton />
              </>
            ) : pendingWithGame.length > 0 || reviewedWithGame.length > 0 ? (
              <>
                {pendingWithGame.map((r, i) => {
                  const g = gameLookup.get(r.game_id)!;
                  const isHost = r.host_id === profileUser?.id;
                  return (
                    <RequestGameCard
                      key={r.id}
                      game={g}
                      request={r}
                      index={i}
                      isHost={isHost}
                      onCancel={isHost ? undefined : async () => {
                        const prev = myRequests;
                        setMyRequests((rs) => rs.filter((x) => x.id !== r.id));
                        try {
                          await cancelMyJoinRequest(r.game_id);
                          toast("Request canceled.");
                        } catch (e: any) {
                          setMyRequests(prev);
                          toast.error(e.message ?? "Could not cancel.");
                        }
                      }}
                      onApprove={isHost ? async () => {
                        const prev = hostRequests;
                        setHostRequests((rs) => rs.map((x) => x.id === r.id ? { ...x, status: "approved" } : x));
                        try {
                          await reviewJoinRequest(r.id, "approved");
                          toast("Player approved.");
                        } catch (e: any) {
                          setHostRequests(prev);
                          toast.error(e.message ?? "Could not approve.");
                        }
                      } : undefined}
                      onDecline={isHost ? async () => {
                        const prev = hostRequests;
                        setHostRequests((rs) => rs.map((x) => x.id === r.id ? { ...x, status: "rejected" } : x));
                        try {
                          await reviewJoinRequest(r.id, "rejected");
                          toast("Player declined.");
                        } catch (e: any) {
                          setHostRequests(prev);
                          toast.error(e.message ?? "Could not decline.");
                        }
                      } : undefined}

                    />
                  );
                })}
                {reviewedWithGame.map((r, i) => {
                  const g = gameLookup.get(r.game_id)!;
                  const isHost = r.host_id === profileUser?.id;
                  return (
                    <RequestGameCard
                      key={r.id}
                      game={g}
                      request={r}
                      index={pendingWithGame.length + i}
                      isHost={isHost}
                      onWithdraw={isHost || r.status !== "approved" ? undefined : async () => {
                        const prev = myRequests;
                        setMyRequests((rs) => rs.filter((x) => x.id !== r.id));
                        try {
                          await withdrawMyApprovedJoinRequest(r.game_id);
                          leaveGame(r.game_id);
                          toast("You withdrew from the game.");
                        } catch (e: any) {
                          setMyRequests(prev);
                          toast.error(e.message ?? "Could not withdraw.");
                        }
                      }}
                    />
                  );
                })}
              </>
            ) : (
              <EmptyRequestsState filter={requestFilter} />
            )}
          </div>
        </section>

        {/* Hosting */}
        <section className="mt-8 rounded-3xl border border-border bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime">
                <Crown className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-foreground">
                  Hosting
                </h2>
                <p className="text-[10px] text-muted-foreground">Games you're running</p>
              </div>
            </div>
            {upcomingGroups.hosting.length > 0 && (
              <span className="rounded-full bg-lime/15 px-2.5 py-1 text-[10px] font-bold text-lime">
                {upcomingGroups.hosting.length}
              </span>
            )}
          </div>
          {upcomingGroups.hosting.length > 0 ? (
            <div className="space-y-3">
              {upcomingGroups.hosting.map((g, i) => (
                <GameCard key={g.id} game={g} index={i} />
              ))}
            </div>
          ) : (
            <Link
              to="/create"
              className="block rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-center transition-colors hover:border-lime/40"
            >
              <div className="font-display text-base font-bold">No hosted games</div>
              <p className="text-xs text-muted-foreground mt-1">Create a game to start hosting.</p>
            </Link>
          )}
        </section>

        {/* Pickup / Playing */}
        <section className="mt-8 rounded-3xl border border-border bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime">
                <Users className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-foreground">
                  Pickup
                </h2>
                <p className="text-[10px] text-muted-foreground">Games you're joining</p>
              </div>
            </div>
            {upcomingGroups.playing.length > 0 && (
              <span className="rounded-full bg-lime/15 px-2.5 py-1 text-[10px] font-bold text-lime">
                {upcomingGroups.playing.length}
              </span>
            )}
          </div>
          {upcomingGroups.playing.length > 0 ? (
            <div className="space-y-3">
              {upcomingGroups.playing.map((g, i) => (
                <GameCard key={g.id} game={g} index={i} />
              ))}
            </div>
          ) : (
            <Link
              to="/feed"
              className="block rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-center transition-colors hover:border-lime/40"
            >
              <div className="font-display text-base font-bold">No pickup games</div>
              <p className="text-xs text-muted-foreground mt-1">Join a run to see it here.</p>
            </Link>
          )}
        </section>


        {/* Sports & skill */}
        <div className="mt-8">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Sports
          </h2>
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
                {s.positions && s.positions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.positions.map((p) => (
                      <span
                        key={p}
                        className="rounded-full border border-lime/30 bg-lime/10 px-2 py-0.5 text-[10px] font-semibold text-lime"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Badges */}
        <div className="mt-8">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Trophy className="h-4 w-4" /> Badges
          </h2>
          <div className="flex flex-wrap gap-2">
            {me.badges.map((b) => (
              <span
                key={b}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold"
              >
                {b}
              </span>
            ))}
          </div>
        </div>

        {/* Reviews popup */}
        <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-xl">
            <DialogHeader className="sr-only">
              <DialogTitle>Reviews</DialogTitle>
            </DialogHeader>
            <div className="p-4">
              <ReviewsSection
                revieweeId="me"
                revieweeKind="player"
                revieweeName={me.name}
                isOwner
              />
            </div>
          </DialogContent>
        </Dialog>
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
