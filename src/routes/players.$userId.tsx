import { createFileRoute, Link, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, MessageCircle, Loader2, Calendar, MapPin, Shield, Trophy, UserPlus, UserCheck, Building2, ShieldCheck } from "lucide-react";
import { useFollow } from "@/lib/follows";
import { toast } from "sonner";
import { formatAvailabilityWindow } from "@/lib/availability-timeslots";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { SPORTS, HERO_IMAGE } from "@/lib/sample-data";
import { formatSportLevel, parseSportLevels } from "@/lib/sport-levels";

import { kmToMi, formatDistance } from "@/lib/distance";
import type { PlayerAvailability } from "@/lib/availability";
import { ReviewsSection } from "@/components/ReviewsSection";
import { FollowSheet, UserSafetyMenu } from "@/components/FollowSheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReputationBadge } from "@/components/ReputationBadge";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { useProfileOverrides, useDistanceUnit } from "@/lib/user-prefs-store";
import { ProfileLinksList } from "@/components/ProfileLinks";
import { BadgeList } from "@/components/BadgeList";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/players/$userId")({
  head: () => ({ meta: [{ title: "Player profile — OpenRun" }] }),
  component: PlayerProfilePage,
});

type ProfileRow = {
  id: string;
  display_name: string;
  avatar_initials: string | null;
  bio: string | null;
  sport: string | null;
  username: string | null;
  city: string | null;
  search_radius_mi?: number | null;
  avatar_url: string | null;
  cover_url: string | null;
  graduating_class: number | null;
  links: any;
};

function PlayerProfilePage() {
  const { userId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [age, setAge] = useState<number | null>(null);
  const [availability, setAvailability] = useState<PlayerAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [followList, setFollowList] = useState<null | "followers" | "following">(null);
  const [unfollowOpen, setUnfollowOpen] = useState(false);

  const overrides = useProfileOverrides(userId);
  const unit = useDistanceUnit();
  const reviews = useReviewsFor(userId);
  const rep = useMemo(() => computeReputation(reviews, "player"), [reviews]);
  const follow = useFollow(userId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, display_name, avatar_initials, bio, sport, username, city, avatar_url, cover_url, graduating_class, search_radius_mi, links, sport_levels",
        )
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("player_availabilities" as any)
        .select("*")
        .eq("user_id", userId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([prof, avail]) => {
      if (cancelled) return;
      if (prof.error) toast.error(prof.error.message);
      setProfile((prof.data as ProfileRow) ?? null);
      (supabase.rpc as any)("profile_ages", { _ids: [userId] }).then(
        ({ data }: { data: { age: number | null }[] | null }) => {
          if (!cancelled) setAge(data?.[0]?.age ?? null);
        },
      );
      setAvailability((avail.data as unknown as PlayerAvailability) ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // If viewing your own card, redirect to the full profile page
  if (user && user.id === userId) {
    return <Navigate to="/profile" />;
  }

  const handleMessage = async () => {
    if (!user) {
      toast.error("Sign in to message this player.");
      return;
    }
    setOpening(true);
    try {
      const id = await getOrCreateDirectConversation(userId);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (e: any) {
      toast.error(e.message || "Couldn't open chat");
    } finally {
      setOpening(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-4 pt-6 pb-24">
        <div className="h-44 animate-pulse rounded-2xl bg-surface/40" />
        <div className="mt-4 h-40 animate-pulse rounded-2xl border border-border bg-surface/40" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-md px-4 pt-6 pb-24">
        <Link
          to="/players"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to players
        </Link>
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
          <p className="font-semibold">Player not found</p>
          <p className="text-sm text-muted-foreground mt-1">This profile may have been removed.</p>
        </div>
      </div>
    );
  }

  const initials =
    overrides.avatar || profile.avatar_initials || profile.display_name.slice(0, 2).toUpperCase();
  const displayName = overrides.name || profile.display_name;
  const username = (
    overrides.username || (profile.username ? `@${profile.username.replace(/^@/, "")}` : "")
  ).trim();
  const bio = overrides.bio ?? profile.bio ?? "";
  const city = overrides.city ?? profile.city ?? "";
  const searchRadiusMi = (profile as any).search_radius_mi as number | null | undefined;
  const sportLevels = parseSportLevels((profile as any).sport_levels);
  const sportsBase: { name: string }[] = overrides.sports?.length
    ? overrides.sports
    : Object.keys(sportLevels).length
      ? Object.keys(sportLevels).map((name) => ({ name }))
      : availability?.sports?.length
        ? availability.sports.map((name) => ({ name }))
        : profile.sport
          ? [{ name: profile.sport as any }]
          : [];
  const sportsList = sportsBase.map((s) => ({
    ...s,
    level: (s as any).level ?? sportLevels[s.name] ?? null,
  }));

  const badges = overrides.badges ?? [];
  const dbLinks = Array.isArray(profile.links) ? (profile.links as any[]) : [];
  const links = overrides.links?.length ? overrides.links : dbLinks;
  const avatarUrl = overrides.avatarUrl ?? profile.avatar_url ?? undefined;
  const coverUrl = overrides.coverUrl ?? profile.cover_url ?? undefined;
  const stats = { played: 0, reliability: 100, sportsmanship: 5, friends: 0 };

  return (
    <div className="mx-auto max-w-md pb-28">
      {/* Cover */}
      <div className="relative h-44">
        <img src={coverUrl ?? HERO_IMAGE} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background" />
        <div className="absolute top-4 left-4">
          <Link
            to="/players"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
            aria-label="Back to players"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Identity */}
      <div className="px-4 -mt-12 relative">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 16 }}
          className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border-4 border-background bg-lime-gradient font-display text-3xl font-bold text-primary-foreground glow-lime"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </motion.div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <span className="truncate">{displayName}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime shrink-0">
                <Shield className="h-3 w-3" /> Verified
              </span>
            </h1>
            <div className="text-sm text-muted-foreground truncate">
              {[
                username,
                city,
                age != null ? `${age}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {searchRadiusMi != null && (
              <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-lime" />
                {city || "Anywhere"} · travels up to {formatDistance(searchRadiusMi, unit)}
              </div>
            )}
            {profile.graduating_class && (
              <div className="mt-1 text-xs text-muted-foreground">
                🎓 Class of {profile.graduating_class}
              </div>
            )}
          </div>
          {/* IG-style inline stats */}
          <div className="shrink-0 flex items-center gap-4 text-center">
            <StatCell k={stats.played} v="games" />
            <StatCell
              k={follow.followers}
              v="followers"
              onClick={() => setFollowList("followers")}
            />
            <StatCell
              k={follow.following}
              v="following"
              onClick={() => setFollowList("following")}
            />
          </div>
        </div>

        {bio && <p className="mt-3 text-sm text-foreground/90 whitespace-pre-wrap">{bio}</p>}

        {/* Profile links */}
        {links.length > 0 && (
          <div className="mt-3">
            <ProfileLinksList links={links} />
          </div>
        )}

        {/* Gyms (live) */}
        <PlayerOrgsSection userId={userId} />



        {/* Action row — IG-style Follow / Message */}
        <div className="mt-4 flex items-center gap-2">
          <div className="grid flex-1 grid-cols-2 gap-2">
          {follow.isFollowing ? (
            <Popover open={unfollowOpen} onOpenChange={setUnfollowOpen}>
              <PopoverTrigger asChild>
                <Button
                  disabled={follow.pending || !user}
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-border bg-surface font-semibold"
                >
                  <UserCheck className="h-4 w-4 mr-1.5" /> Following
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-3">
                <p className="text-sm">
                  Unfollow <span className="font-semibold">{displayName}</span>?
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setUnfollowOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={follow.pending}
                    onClick={() => {
                      follow.toggle();
                      setUnfollowOpen(false);
                    }}
                  >
                    Unfollow
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Button
              onClick={() => {
                if (!user) {
                  toast.error("Sign in to follow this player.");
                  return;
                }
                follow.toggle();
              }}
              disabled={follow.pending}
              size="sm"
              className="rounded-lg bg-lime-gradient font-semibold text-primary-foreground"
            >
              <UserPlus className="h-4 w-4 mr-1.5" /> Follow
            </Button>
          )}
          <Button
            onClick={handleMessage}
            disabled={opening}
            variant="outline"
            size="sm"
            className="rounded-lg border-border bg-surface font-semibold"
          >
            {opening ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4 mr-1.5" />
            )}
            Message
          </Button>
          </div>
          <UserSafetyMenu userId={userId} displayName={displayName} align="end" />
        </div>

        {/* Reputation badge (opens reviews popup) */}
        <div className="mt-4">
          <ReputationBadge
            rep={rep}
            onClick={() => setReviewsOpen(true)}
            ariaLabel={`Open reviews for ${displayName}. Trust score ${rep.trustScore}, ${rep.avg.toFixed(1)} out of 5 from ${rep.count} review${rep.count === 1 ? "" : "s"}.`}
          />
        </div>

        {/* Open availability */}
        {availability && (
          <div className="mt-6">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Calendar className="h-4 w-4" /> Open availability
            </h2>
            <PlayerCard a={availability} />
          </div>
        )}

        {/* Sports */}
        {sportsList.length > 0 && (
          <div className="mt-6">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Sports
            </h2>
            <div className="space-y-2">
              {sportsList.map((s) => (
                <div key={s.name} className="rounded-2xl border border-border bg-surface p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span>
                      {SPORTS.find((sp) => sp.name === s.name)?.emoji ?? "🎯"} {s.name}
                    </span>
                    {formatSportLevel(s.level) && (
                      <span className="rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] font-bold text-lime">
                        {formatSportLevel(s.level)}
                      </span>
                    )}
                  </div>

                  {"positions" in s && Array.isArray((s as any).positions) && (s as any).positions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {((s as any).positions as string[]).map((p) => (
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
        )}

        {/* Badges — earned from attendance reliability + sportsmanship */}
        {badges.length > 0 && <BadgeList className="mt-6" badgeIds={badges} />}


        {/* Reviews popup */}
        <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
          <DialogContent
            className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-xl"
            aria-labelledby="player-reviews-title"
            aria-describedby="player-reviews-desc"
          >
            <DialogHeader className="sr-only">
              <DialogTitle id="player-reviews-title">Reviews for {displayName}</DialogTitle>
              <DialogDescription id="player-reviews-desc">
                Browse, filter, and sort reviews left for this player. Press Escape to close.
              </DialogDescription>
            </DialogHeader>
            <div className="p-4">
              <ReviewsSection
                revieweeId={userId}
                revieweeKind="player"
                revieweeName={displayName}
                isOwner={user?.id === userId}
              />
            </div>
          </DialogContent>
        </Dialog>

        <FollowSheet
          open={followList !== null}
          onOpenChange={(v: boolean) => !v && setFollowList(null)}
          userId={userId}
          displayName={displayName}
          initialTab={followList ?? "followers"}
        />
      </div>
    </div>
  );
}

function StatCell({
  k,
  v,
  onClick,
}: {
  k: number | string;
  v: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="font-display text-base font-bold leading-tight">{k}</div>
      <div className="text-[11px] text-muted-foreground">{v}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="min-w-[56px] rounded-lg px-1 transition-colors hover:bg-surface"
      >
        {inner}
      </button>
    );
  }
  return <div className="min-w-[56px] px-1">{inner}</div>;
}

function PlayerCard({ a }: { a: PlayerAvailability }) {
  const window = formatWindow(a);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Looking to play
        </span>
        <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
          {a.skill_level}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {a.sports.length === 0 ? (
          <span className="text-xs text-muted-foreground">Any sport</span>
        ) : (
          a.sports.map((s) => {
            const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
            return (
              <span
                key={s}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold"
              >
                {emoji} {s}
              </span>
            );
          })
        )}
      </div>
      {window && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" /> {window}
        </p>
      )}
      {(a.city || a.travel_radius_km) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {a.city || "Anywhere"} · up to{" "}
          {kmToMi(a.travel_radius_km)} mi
        </p>
      )}
      {a.note && <p className="mt-3 text-sm leading-snug">{a.note}</p>}
    </div>
  );
}

const formatWindow = (a: PlayerAvailability): string => formatAvailabilityWindow(a);

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatBirthday(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}


type PlayerOrgRow = {
  id: string;
  org_id: string;
  role: string;
  org: {
    id: string;
    name: string;
    handle: string | null;
    avatar: string | null;
    city: string | null;
    verified: boolean | null;
  } | null;
};

function PlayerOrgsSection({ userId }: { userId: string }) {
  const [rows, setRows] = useState<PlayerOrgRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchRows = async () => {
      const { data } = await supabase
        .from("trainer_org_members")
        .select("id, org_id, role, org:org_id(id,name,handle,avatar,city,verified)")
        .eq("user_id", userId);
      if (cancelled) return;
      setRows(((data as unknown as PlayerOrgRow[]) ?? []).filter((r) => r.org));
      setLoaded(true);
    };
    fetchRows();

    const ch = supabase
      .channel(`player-orgs:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trainer_org_members", filter: `user_id=eq.${userId}` },
        () => {
          fetchRows();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trainer_orgs" },
        () => {
          fetchRows();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [userId]);

  if (!loaded || rows.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {rows.map((r) => {
        const o = r.org!;
        return (
          <Link
            key={r.id}
            to="/orgs/$orgId"
            params={{ orgId: o.id }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-lime/60 hover:text-lime"
          >
            <Building2 className="h-3.5 w-3.5" />
            <span className="truncate max-w-[160px]">{o.name}</span>
            {o.verified && <ShieldCheck className="h-3 w-3 text-lime" />}
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {r.role}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

