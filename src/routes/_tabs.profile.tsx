import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { formatSportLevel } from "@/lib/sport-levels";

import { Settings, Clock, Star, Crown, Users, Clapperboard, Loader2 } from "lucide-react";
import { GameRecapPanel, ReelManageRow } from "@/components/GameRecapPanel";
import { InlineVideoPlayer } from "@/components/InlineVideoPlayer";
import { RECAP_COLUMNS, type RecapSummary } from "@/lib/recaps";
import { useFollow } from "@/lib/follows";
import { FollowSheet } from "@/components/FollowSheet";
import { ME, GAMES, type Game } from "@/lib/sample-data";
import { GameCard } from "@/components/GameCard";
import { RequestGameCard } from "@/components/RequestGameCard";
import { RequestGameCardSkeleton } from "@/components/RequestGameCardSkeleton";
import { GameCardSkeleton } from "@/components/GameCardSkeleton";
import { InfiniteList } from "@/components/InfiniteList";
import { EmptyRequestsState } from "@/components/EmptyRequestsState";
import { ReviewsSection } from "@/components/ReviewsSection";
import { SkillRatingCard } from "@/components/SkillRatingCard";
import { HERO_IMAGE } from "@/lib/sample-data";
import { computeReputation } from "@/lib/reviews";
import { useReviewsFor } from "@/lib/reviews-db";
import { ReputationBadge } from "@/components/ReputationBadge";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getCurrentUser, useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useJoinedGameIds } from "@/lib/games-store";
import { useHostedGames } from "@/lib/hosted-games-store";
import { readOverrides, useMyProfile } from "@/lib/user-prefs-store";
import { ProfileLinksList } from "@/components/ProfileLinks";
import {
  listMyJoinRequests,
  listHostJoinRequests,
  cancelMyJoinRequest,
  reviewJoinRequest,
  type JoinRequest,
} from "@/lib/payments";
import { withdrawFromGame } from "@/lib/leave-game";
import { LeaveFlowButton } from "@/components/LeaveFlowButton";
import { MySignups } from "@/components/profile/MySignups";
import { groupProfileGames } from "@/lib/game-series";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  attachReelToGame,
  deleteReels,
  listAttachableGames,
  setReelsHidden,
} from "@/lib/reels.functions";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BadgeList } from "@/components/BadgeList";
import { makeBadgeStats } from "@/lib/badges";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useMyProfiles } from "@/lib/account-profiles";
import { ActiveProfileView } from "@/components/profile/ActiveProfileView";
import {
  ProfileChannelHeader,
  ChannelPill,
  channelPillClass,
} from "@/components/profile/ProfileChannelHeader";
import { ProfileAboutSheet, AboutBlock, AboutStats } from "@/components/profile/ProfileAboutSheet";
import { ChannelTabs } from "@/components/profile/ChannelTabs";
import { ProfileVisibilityRow } from "@/components/profile/ProfileVisibilityRow";
import { MyWaitlistCard } from "@/components/MyWaitlistCard";
import { useIsGuardianAccount } from "@/components/child/GuardianProfileCard";

export const Route = createFileRoute("/_tabs/profile")({
  head: () =>
    pageHead({
      path: "/profile",
      title: "Your profile — BallaCity",
      description:
        "Your BallaCity profile: sports, skill levels, availability, games, and reviews.",
      noindex: true,
    }),
  // URL-persisted requests filter (all/host/player).
  validateSearch: zodValidator(z.object({ req: fallback(z.string(), "").default("") })),
  component: ProfileRoute,
});

/**
 * The Profile tab follows the account's active profile: the personal player
 * profile renders the player view, a team/trainer/gym renders that profile.
 */
function ProfileRoute() {
  const { active, loading } = useMyProfiles();
  const guardian = useIsGuardianAccount();
  const navigate = useNavigate();
  useEffect(() => {
    if (guardian.isGuardian) navigate({ to: "/parent", replace: true });
  }, [guardian.isGuardian, navigate]);
  if (guardian.loading || guardian.isGuardian) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (!loading && active && active.kind !== "player") {
    return (
      <div className="page-shell-flush">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <ProfileSwitcher />
        </div>
        <ActiveProfileView profile={active} />
      </div>
    );
  }
  return <PlayerProfile />;
}

function PlayerProfile() {
  const myReviews = useReviewsFor("me");
  const myRep = useMemo(() => computeReputation(myReviews, "player"), [myReviews]);
  const { user, loading } = useAuth();
  const [confirmedUser, setConfirmedUser] = useState<User | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const [followList, setFollowList] = useState<null | "followers" | "following">(null);
  const [activeTab, setActiveTab] = useState<
    "games" | "hosting" | "requests" | "reviews" | "archive"
  >("games");
  const profileUser = user ?? confirmedUser;
  const me = useMyProfile(profileUser);
  const follow = useFollow(profileUser?.id ?? "");
  const joinedGameIds = useJoinedGameIds();
  const hosted = useHostedGames();
  const upcomingGroups = useMemo(
    () => groupProfileGames([...hosted, ...GAMES], new Set(joinedGameIds), profileUser?.id),
    [joinedGameIds, hosted, profileUser?.id],
  );

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
      const [mine, hosted] = await Promise.all([listMyJoinRequests(), listHostJoinRequests()]);
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

  // Recaps (highlight reels) per finished game, for the Archive status + inline player.
  const [recapsByGame, setRecapsByGame] = useState<Record<string, RecapSummary[]>>({});
  const [allRecaps, setAllRecaps] = useState<RecapSummary[]>([]);
  const [recapTick, setRecapTick] = useState(0);
  useEffect(() => {
    if (!profileUser) {
      setRecapsByGame({});
      setAllRecaps([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      supabase
        .from("highlight_reels")
        .select(RECAP_COLUMNS)
        .eq("user_id", profileUser.id)
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          if (cancelled) return;
          const rows = (data ?? []) as RecapSummary[];
          setAllRecaps(rows);
          const map: Record<string, RecapSummary[]> = {};
          rows.forEach((r) => {
            if (!r.game_id) return;
            (map[r.game_id] ??= []).push(r);
          });
          setRecapsByGame(map);
        });
    load();

    // Live progress: pipeline updates land as UPDATEs on the user's own rows.
    const channel = supabase
      .channel(`recaps-${profileUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "highlight_reels",
          filter: `user_id=eq.${profileUser.id}`,
        },
        (payload) => {
          const row = payload.new as RecapSummary | null;
          if (row?.status === "completed" && (payload.old as any)?.status !== "completed") {
            toast.success(`Recap ready${row.game_title ? ` · ${row.game_title}` : ""}`);
          }
          load();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [profileUser?.id, recapTick]);

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
      <div className="page-shell-content flex min-h-dvh flex-col items-center justify-center pb-28 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-lime-gradient font-display text-xl font-bold text-primary-foreground glow-lime">
          O
        </div>
        <h1 className="mt-5 page-title">Sign in to view your profile</h1>
        <p className="mt-2 page-subtitle">
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

  const age = me.birthday ? ageFrom(me.birthday) : null;

  return (
    <div className="page-shell-flush">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <ProfileSwitcher />
      </div>
      <ProfileChannelHeader
        bannerUrl={me.coverUrl ?? HERO_IMAGE}
        bannerOverlay={
          <Link
            to="/settings"
            className="grid h-9 w-9 place-items-center rounded-full bg-background/70 backdrop-blur"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
        }
        avatarUrl={me.avatarUrl}
        avatarFallback={me.avatar}
        name={me.name}
        meta={[
          me.username,
          age != null ? `${age}` : null,
          me.city,
          <button
            key="followers"
            type="button"
            onClick={() => setFollowList("followers")}
            className="underline-offset-2 hover:underline"
          >
            {follow.followers} followers
          </button>,
          <button
            key="following"
            type="button"
            onClick={() => setFollowList("following")}
            className="underline-offset-2 hover:underline"
          >
            {follow.following} following
          </button>,
          `${upcomingGroups.total} game${upcomingGroups.total === 1 ? "" : "s"}`,
        ].filter(Boolean)}
        description={me.bio}
        onOpenAbout={() => setAboutOpen(true)}
        actions={
          <>
            <Link to="/profile/edit" className={channelPillClass("primary")}>
              Edit profile
            </Link>
            <ChannelPill onClick={() => setReviewsOpen(true)}>
              <Star className="h-3.5 w-3.5" /> Reviews · {myRep.count}
            </ChannelPill>
            <ChannelPill onClick={() => setAboutOpen(true)}>About</ChannelPill>
            <Link to="/settings" className={channelPillClass()}>
              Settings
            </Link>
            <Link to="/account/ai-privacy" className={channelPillClass()}>
              AI &amp; Video Privacy
            </Link>
          </>
        }
      />

      <ProfileVisibilityRow />

      <ProfileAboutSheet open={aboutOpen} onOpenChange={setAboutOpen}>
        {me.bio && (
          <AboutBlock label="Bio">
            <p className="whitespace-pre-wrap">{me.bio}</p>
          </AboutBlock>
        )}
        <AboutBlock label="Details">
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>{me.username}</li>
            {me.city && <li>{me.city}</li>}
            {me.birthday && <li>Born {formatBirthday(me.birthday)}</li>}
            {me.graduatingClass && <li>Class of {me.graduatingClass}</li>}
          </ul>
        </AboutBlock>
        <AboutBlock label="Stats">
          <AboutStats
            items={[
              { k: `${me.stats.reliability}%`, v: "Reliable" },
              { k: me.stats.sportsmanship, v: "Sport" },
              { k: me.stats.friends, v: "Crew" },
            ]}
          />
        </AboutBlock>
        {me.links && me.links.length > 0 && (
          <AboutBlock label="Links">
            <ProfileLinksList links={me.links} />
          </AboutBlock>
        )}
        <AboutBlock label="Reputation">
          <ReputationBadge rep={myRep} onClick={() => setReviewsOpen(true)} />
        </AboutBlock>
      </ProfileAboutSheet>

      <div className="px-4">
        <ProfileReelsSection recaps={allRecaps} onChanged={() => setRecapTick((t) => t + 1)} />
        <ChannelTabs
          className="mt-5"
          value={activeTab}
          onChange={(v) => setActiveTab(v)}
          tabs={[
            { k: "games" as const, label: "Games" },
            { k: "hosting" as const, label: "Hosting" },
            { k: "requests" as const, label: "Requests", count: pendingWithGame.length },
            { k: "reviews" as const, label: "Reviews" },
            {
              k: "archive" as const,
              label: "Archive",
              count: upcomingGroups.archiveTotal,
            },
          ]}
        />

        {/* Pending approvals */}

        <section className={`mt-6 ${activeTab === "requests" ? "" : "hidden"}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-2xl border border-coral/30 bg-coral/10 text-coral">
                <Clock className="h-4 w-4" />
              </span>
              <div>
                <h2 className="section-eyebrow text-foreground">Pending approvals</h2>
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
          {requestsLoading ? (
            <div className="space-y-3">
              <RequestGameCardSkeleton />
              <RequestGameCardSkeleton />
            </div>
          ) : pendingWithGame.length > 0 || reviewedWithGame.length > 0 ? (
            <InfiniteList
              items={[
                ...pendingWithGame.map((r) => ({ r, phase: "pending" as const })),
                ...reviewedWithGame.map((r) => ({ r, phase: "reviewed" as const })),
              ]}
              pageSize={6}
              keyFor={({ r }) => r.id}
              renderSkeleton={() => <RequestGameCardSkeleton />}
              resetKey={`req-${requestFilter}-${pendingWithGame.length}-${reviewedWithGame.length}`}
              renderItem={({ r, phase }, i) => {
                const g = gameLookup.get(r.game_id)!;
                const isHost = r.host_id === profileUser?.id;
                if (phase === "pending") {
                  return (
                    <RequestGameCard
                      game={g}
                      request={r}
                      index={i}
                      isHost={isHost}
                      onCancel={
                        isHost
                          ? undefined
                          : async () => {
                              const prev = myRequests;
                              setMyRequests((rs) => rs.filter((x) => x.id !== r.id));
                              try {
                                await cancelMyJoinRequest(r.game_id);
                                toast("Request canceled.");
                              } catch (e: any) {
                                setMyRequests(prev);
                                toast.error(e.message ?? "Could not cancel.");
                              }
                            }
                      }
                      onApprove={
                        isHost
                          ? async () => {
                              const prev = hostRequests;
                              setHostRequests((rs) =>
                                rs.map((x) => (x.id === r.id ? { ...x, status: "approved" } : x)),
                              );
                              try {
                                await reviewJoinRequest(r.id, "approved");
                                toast("Player approved.");
                              } catch (e: any) {
                                setHostRequests(prev);
                                toast.error(e.message ?? "Could not approve.");
                              }
                            }
                          : undefined
                      }
                      onDecline={
                        isHost
                          ? async () => {
                              const prev = hostRequests;
                              setHostRequests((rs) =>
                                rs.map((x) => (x.id === r.id ? { ...x, status: "rejected" } : x)),
                              );
                              try {
                                await reviewJoinRequest(r.id, "rejected");
                                toast("Player declined.");
                              } catch (e: any) {
                                setHostRequests(prev);
                                toast.error(e.message ?? "Could not decline.");
                              }
                            }
                          : undefined
                      }
                    />
                  );
                }
                return (
                  <RequestGameCard
                    game={g}
                    request={r}
                    index={i}
                    isHost={isHost}
                    onWithdraw={
                      isHost || r.status !== "approved"
                        ? undefined
                        : async () => {
                            const prev = myRequests;
                            setMyRequests((rs) => rs.filter((x) => x.id !== r.id));
                            try {
                              await withdrawFromGame(r.game_id, g.title);
                              toast("You withdrew from the game.");
                            } catch (e: any) {
                              setMyRequests(prev);
                              toast.error(e.message ?? "Could not withdraw.");
                            }
                          }
                    }
                  />
                );
              }}
            />
          ) : (
            <EmptyRequestsState filter={requestFilter} />
          )}
        </section>

        {/* Hosting */}
        <section className={`mt-6 ${activeTab === "hosting" ? "" : "hidden"}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime">
                <Crown className="h-4 w-4" />
              </span>
              <div>
                <h2 className="section-eyebrow text-foreground">Hosting</h2>
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
            <InfiniteList
              items={upcomingGroups.hosting}
              pageSize={6}
              keyFor={(g) => g.id}
              renderItem={(g, i) => <GameCard game={g} index={i} />}
              renderSkeleton={() => <GameCardSkeleton />}
              resetKey="hosting"
            />
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

        {/* Tryouts, camps and trainer sessions — cancellable from here */}
        <div className={activeTab === "games" ? "" : "hidden"}>
          <MySignups />
        </div>

        {/* Pickup / Playing */}
        <section className={`mt-6 ${activeTab === "games" ? "" : "hidden"}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime">
                <Users className="h-4 w-4" />
              </span>
              <div>
                <h2 className="section-eyebrow text-foreground">Pickup</h2>
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
            <InfiniteList
              items={upcomingGroups.playing}
              pageSize={6}
              keyFor={(g) => g.id}
              renderItem={(g, i) => (
                <div>
                  <GameCard game={g} index={i} />
                  {/* Cancel / withdraw / leave, whichever fits where they are in the flow. */}
                  <div className="mt-1.5 text-right">
                    <LeaveFlowButton gameId={g.id} gameTitle={g.title} variant="link" />
                  </div>
                </div>
              )}
              renderSkeleton={() => <GameCardSkeleton />}
              resetKey="playing"
            />
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

        {/* Archive — completed games */}
        <section className={`mt-6 ${activeTab === "archive" ? "" : "hidden"}`}>
          {upcomingGroups.archiveTotal === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-center">
              <div className="font-display text-base font-bold">No completed games yet</div>
              <p className="text-xs text-muted-foreground mt-1">
                Games you host or join will appear here once they finish.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {upcomingGroups.archiveHosting.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-2xl border border-border bg-surface text-muted-foreground">
                        <Crown className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="section-eyebrow text-foreground">Hosted</h2>
                        <p className="text-[10px] text-muted-foreground">Completed games you ran</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
                      {upcomingGroups.archiveHosting.length}
                    </span>
                  </div>
                  <InfiniteList
                    items={upcomingGroups.archiveHosting}
                    pageSize={6}
                    keyFor={(g) => g.id}
                    renderItem={(g, i) => (
                      <ArchiveGameItem
                        game={g}
                        index={i}
                        recaps={recapsByGame[g.id] ?? []}
                        onRecapsChanged={() => setRecapTick((t) => t + 1)}
                      />
                    )}
                    renderSkeleton={() => <GameCardSkeleton />}
                    resetKey="archive-hosting"
                  />
                </div>
              )}
              {upcomingGroups.archivePlaying.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-2xl border border-border bg-surface text-muted-foreground">
                        <Users className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="section-eyebrow text-foreground">Joined</h2>
                        <p className="text-[10px] text-muted-foreground">
                          Completed games you played
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
                      {upcomingGroups.archivePlaying.length}
                    </span>
                  </div>
                  <InfiniteList
                    items={upcomingGroups.archivePlaying}
                    pageSize={6}
                    keyFor={(g) => g.id}
                    renderItem={(g, i) => (
                      <ArchiveGameItem
                        game={g}
                        index={i}
                        recaps={recapsByGame[g.id] ?? []}
                        onRecapsChanged={() => setRecapTick((t) => t + 1)}
                      />
                    )}
                    renderSkeleton={() => <GameCardSkeleton />}
                    resetKey="archive-playing"
                  />
                </div>
              )}
            </div>
          )}
        </section>

        <div className={activeTab === "games" ? "" : "hidden"}>
          <MyWaitlistCard />
        </div>

        {/* Sports */}
        <div className={`mt-8 ${activeTab === "games" && me.sports.length > 0 ? "" : "hidden"}`}>
          <h2 className="section-eyebrow text-muted-foreground mb-2">Sports</h2>
          <div className="space-y-2">
            {me.sports.map((s) => (
              <div key={s.name} className="rounded-2xl border border-border bg-surface p-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{s.name}</span>
                  {formatSportLevel(s.level) && (
                    <span className="rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] font-bold text-lime">
                      {formatSportLevel(s.level)}
                    </span>
                  )}
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

        {/* Badges — earned from attendance reliability + sportsmanship */}
        <BadgeList
          className={`mt-8 ${activeTab === "games" ? "" : "hidden"}`}
          badgeIds={me.badges}
          stats={makeBadgeStats({
            gamesPlayed: me.stats.played,
            hosted: me.stats.hosted ?? 0,
            showUpRate: (me.stats.reliability ?? 0) / 100,
            onTimeRate: (me.stats.reliability ?? 0) / 100,
            sportsmanshipRating: me.stats.sportsmanship ?? 0,
          })}
          showProgress
        />

        {/* Reviews tab — inline */}
        <div className={`mt-6 ${activeTab === "reviews" ? "" : "hidden"}`}>
          <SkillRatingCard userId={user?.id} isOwner />
          <ReviewsSection revieweeId="me" revieweeKind="player" revieweeName={me.name} isOwner />
        </div>

        {/* Follow list sheet */}
        <FollowSheet
          open={followList !== null}
          onOpenChange={(v: boolean) => !v && setFollowList(null)}
          userId={profileUser.id}
          displayName={me.name}
          initialTab={followList ?? "followers"}
        />

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

/** A single reel on the profile: playable when completed, with manage controls. */
function ProfileReelItem({
  reel,
  onChanged,
  selectable,
  selected,
  onToggleSelected,
  onAttach,
}: {
  reel: RecapSummary;
  onChanged?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  onAttach?: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    setThumbUrl(null);
    if (!reel.thumbnail_path) return;
    let cancelled = false;
    supabase.storage
      .from("highlight-videos")
      .createSignedUrl(reel.thumbnail_path, 3600)
      .then(({ data }) => {
        if (!cancelled) setThumbUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [reel.id, reel.thumbnail_path]);

  return (
    <div
      className={`rounded-2xl border bg-surface p-3 ${
        selectable && selected ? "border-lime" : "border-border"
      }`}
    >
      {selectable && (
        <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={!!selected} onCheckedChange={() => onToggleSelected?.()} />
          Select this reel
        </label>
      )}
      {reel.status === "completed" ? (
        <InlineVideoPlayer
          videoPath={reel.playback_path ?? reel.video_path}
          fallbackVideoPath={reel.playback_path ? reel.video_path : null}
          thumbnailUrl={thumbUrl}
          ariaLabel={`Highlight reel ${reel.ai_title || reel.title}`}
          repair={{ reelId: reel.id, videoPath: reel.video_path, onRepaired: onChanged }}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2">
          {reel.status === "processing" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-lime" />
          ) : (
            <Clapperboard className="h-3.5 w-3.5 text-amber-300" />
          )}
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {reel.status === "processing"
              ? "Processing…"
              : (reel.error_message ?? "Processing didn't finish")}
          </p>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {reel.hidden_at && (
            <span className="mr-1 rounded bg-surface px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide">
              Hidden
            </span>
          )}
          {reel.ai_title || reel.title}
        </p>
        <ReelManageRow reel={reel} onChanged={onChanged} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {reel.game_title ? `Linked to ${reel.game_title}` : "Not linked to a game"}
        </p>
        <button
          type="button"
          onClick={onAttach}
          className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-foreground hover:border-lime"
        >
          {reel.game_id ? "Change game" : "Attach to game"}
        </button>
      </div>
    </div>
  );
}

type AttachableGame = { id: string; title: string; sport: string | null; date: string | null };

/** Dialog that links a reel to one of the caller's hosted/joined games. */
function AttachReelDialog({
  reel,
  onClose,
  onChanged,
}: {
  reel: RecapSummary;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [games, setGames] = useState<AttachableGame[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAttachableGames()
      .then((rows) => {
        if (!cancelled) setGames(rows as AttachableGame[]);
      })
      .catch(() => {
        if (!cancelled) setGames([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const attach = async (gameId: string | null) => {
    setBusy(true);
    try {
      await attachReelToGame({ data: { reelId: reel.id, gameId } });
      toast.success(gameId ? "Reel attached to game" : "Game link removed");
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the reel");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach to game</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Linking a reel places it with that game in feeds and the Archive.
        </p>
        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
          {games === null && <p className="text-xs text-muted-foreground">Loading your games…</p>}
          {games?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No games yet — host or join a game, then come back.
            </p>
          )}
          {games?.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={busy}
              onClick={() => attach(g.id)}
              className={`w-full rounded-xl border px-3 py-2 text-left text-xs disabled:opacity-60 ${
                g.id === reel.game_id ? "border-lime bg-lime/10" : "border-border hover:border-lime"
              }`}
            >
              <span className="block truncate font-semibold text-foreground">{g.title}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {[g.sport, g.date ? new Date(g.date).toLocaleDateString() : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
        {reel.game_id && (
          <button
            type="button"
            disabled={busy}
            onClick={() => attach(null)}
            className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-60"
          >
            Remove game link
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ReelSort = "newest" | "oldest" | "sport";

function reelSport(r: RecapSummary): string | null {
  const s = (r.ai_sport ?? "").trim();
  return s ? s : null;
}

/** Highlight reels strip on the own profile: every reel, game-linked or not. */
function ProfileReelsSection({
  recaps,
  onChanged,
}: {
  recaps: RecapSummary[];
  onChanged?: () => void;
}) {
  const [sport, setSport] = useState<string>("all");
  const [sort, setSort] = useState<ReelSort>("newest");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [attachReel, setAttachReel] = useState<RecapSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const sports = useMemo(() => {
    const set = new Set<string>();
    recaps.forEach((r) => {
      const s = reelSport(r);
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [recaps]);

  const visible = useMemo(() => {
    const filtered =
      sport === "all"
        ? recaps
        : sport === "none"
          ? recaps.filter((r) => !reelSport(r))
          : recaps.filter((r) => reelSport(r) === sport);
    const rows = [...filtered];
    rows.sort((a, b) => {
      if (sort === "sport") {
        const cmp = (reelSport(a) ?? "zzz").localeCompare(reelSport(b) ?? "zzz");
        if (cmp !== 0) return cmp;
      }
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sort === "oldest" ? ta - tb : tb - ta;
    });
    return rows;
  }, [recaps, sport, sort]);

  const selectedRows = useMemo(
    () => visible.filter((r) => selected.includes(r.id)),
    [visible, selected],
  );

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const runBulk = async (action: "hide" | "show" | "delete") => {
    const reelIds = selectedRows.map((r) => r.id);
    if (reelIds.length === 0) return;
    if (action === "delete" && !confirm(`Delete ${reelIds.length} reel(s)? This can't be undone.`))
      return;
    setBusy(true);
    try {
      if (action === "delete") {
        await deleteReels({ data: { reelIds } });
        toast.success(`Deleted ${reelIds.length} reel(s)`);
      } else {
        await setReelsHidden({ data: { reelIds, hidden: action === "hide" } });
        toast.success(action === "hide" ? "Reels hidden" : "Reels visible again");
      }
      setSelected([]);
      setSelecting(false);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBusy(false);
    }
  };

  if (recaps.length === 0) return null;
  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime">
            <Clapperboard className="h-4 w-4" />
          </span>
          <div>
            <h2 className="section-eyebrow text-foreground">Highlight reels</h2>
            <p className="text-[10px] text-muted-foreground">
              {visible.length} of {recaps.length} shown
            </p>
          </div>
        </div>
        <Link
          to="/reels"
          search={{ game: "", title: "", upload: "" }}
          className="text-xs font-medium text-lime"
        >
          Open Reels
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={sport} onValueChange={setSport}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Sport" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sports</SelectItem>
            {sports.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
            <SelectItem value="none">No sport detected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as ReelSort)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="sport">Sport A–Z</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => {
            setSelecting((s) => !s);
            setSelected([]);
          }}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-lime"
        >
          {selecting ? "Done" : "Select"}
        </button>
      </div>

      {selecting && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
          <span className="text-xs text-muted-foreground">{selectedRows.length} selected</span>
          <button
            type="button"
            onClick={() => setSelected(visible.map((r) => r.id))}
            className="text-xs font-semibold text-lime"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="text-xs font-semibold text-muted-foreground"
          >
            Clear
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy || selectedRows.length === 0}
              onClick={() => runBulk("hide")}
              className="rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              Hide
            </button>
            <button
              type="button"
              disabled={busy || selectedRows.length === 0}
              onClick={() => runBulk("show")}
              className="rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              Show
            </button>
            <button
              type="button"
              disabled={busy || selectedRows.length === 0}
              onClick={() => runBulk("delete")}
              className="rounded-full border border-destructive/40 px-3 py-1 text-xs font-semibold text-destructive disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((r) => (
          <ProfileReelItem
            key={r.id}
            reel={r}
            onChanged={onChanged}
            selectable={selecting}
            selected={selected.includes(r.id)}
            onToggleSelected={() => toggle(r.id)}
            onAttach={() => setAttachReel(r)}
          />
        ))}
      </div>

      {attachReel && (
        <AttachReelDialog
          reel={attachReel}
          onClose={() => setAttachReel(null)}
          onChanged={onChanged}
        />
      )}
    </section>
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

/** A finished game in the Archive, with recap status, inline player, and share. */
function ArchiveGameItem({
  game,
  index,
  recaps,
  onRecapsChanged,
}: {
  game: Game;
  index: number;
  recaps: RecapSummary[];
  onRecapsChanged?: () => void;
}) {
  return (
    <div>
      <GameCard game={game} index={index} />
      <GameRecapPanel
        game={{ id: game.id, title: game.title }}
        recaps={recaps}
        isOwner
        onChanged={onRecapsChanged}
      />
    </div>
  );
}
