import { createFileRoute, Link, useNavigate, Navigate } from "@tanstack/react-router";
import { pageHead, ogImageUrl } from "@/lib/seo";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  MessageCircle,
  Loader2,
  Calendar,
  MapPin,
  Shield,
  Trophy,
  UserPlus,
  UserCheck,
  Building2,
  ShieldCheck,
  Share2,
} from "lucide-react";
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
import { ProfileChannelHeader, ChannelPill } from "@/components/profile/ProfileChannelHeader";
import { ProfileAboutSheet, AboutBlock, AboutStats } from "@/components/profile/ProfileAboutSheet";
import { ExpandableAboutSection } from "@/components/ExpandableAboutSection";
import { PlayerShareCard } from "@/components/PlayerShareCard";
import { BadgeList } from "@/components/BadgeList";
import { InlineVideoPlayer } from "@/components/InlineVideoPlayer";
import { listPublicReels } from "@/lib/reels.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/players/$userId")({
  head: ({ params }) => ({
    ...pageHead({
      path: `/players/${params.userId}`,
      title: "Player profile — OpenRun",
      description:
        "See this player's sports, skill levels, availability, badges, and reviews on OpenRun.",
      ogType: "profile",
      image: ogImageUrl({
        kind: "player",
        title: "Player profile",
        subtitle: "Sports, availability, badges, and reviews",
        meta: ["OpenRun player"],
      }),
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        url: `https://open-run-connect.lovable.app/players/${params.userId}`,
      },
    }),
  }),
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [followList, setFollowList] = useState<null | "followers" | "following">(null);
  const [unfollowOpen, setUnfollowOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

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
      <ProfileChannelHeader
        bannerUrl={coverUrl ?? HERO_IMAGE}
        bannerOverlay={
          <Link
            to="/players"
            className="grid h-9 w-9 place-items-center rounded-full bg-background/70 backdrop-blur"
            aria-label="Back to players"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        avatarUrl={avatarUrl}
        avatarFallback={initials}
        name={displayName}
        nameBadge={
          <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
            <Shield className="h-3 w-3" /> Verified
          </span>
        }
        meta={[
          username,
          age != null ? `${age}` : null,
          city,
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
          `${stats.played} game${stats.played === 1 ? "" : "s"}`,
        ].filter(Boolean)}
        description={bio}
        onOpenAbout={() => setAboutOpen(true)}
        actions={
          <>
            {follow.isFollowing ? (
              <Popover open={unfollowOpen} onOpenChange={setUnfollowOpen}>
                <PopoverTrigger asChild>
                  <ChannelPill disabled={follow.pending || !user}>
                    <UserCheck className="h-4 w-4" /> Following
                  </ChannelPill>
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
              <ChannelPill
                variant="primary"
                disabled={follow.pending}
                onClick={() => {
                  if (!user) {
                    toast.error("Sign in to follow this player.");
                    return;
                  }
                  follow.toggle();
                }}
              >
                <UserPlus className="h-4 w-4" /> Follow
              </ChannelPill>
            )}
            <ChannelPill onClick={handleMessage} disabled={opening}>
              {opening ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="h-4 w-4" />
              )}
              Message
            </ChannelPill>
            <ChannelPill onClick={() => setReviewsOpen(true)}>Reviews · {rep.count}</ChannelPill>
            <ChannelPill onClick={() => setAboutOpen(true)}>About</ChannelPill>
            <ChannelPill onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4" /> Share
            </ChannelPill>
            <UserSafetyMenu userId={userId} displayName={displayName} align="end" />
          </>
        }
      />

      <PlayerShareCard
        open={shareOpen}
        onOpenChange={setShareOpen}
        data={{
          userId,
          displayName,
          username: username || undefined,
          initials,
          avatarUrl,
          bio,
          city: city || undefined,
          travelRadius:
            searchRadiusMi != null ? formatDistance(searchRadiusMi, unit) : undefined,
          sports: sportsList.map((s) => ({
            name: s.name,
            level: s.level ? formatSportLevel(s.level as any) : null,
          })),
          trustScore: rep.trustScore,
          reviewCount: rep.count,
          linkCount: links.length,
        }}
      />

      <ProfileAboutSheet open={aboutOpen} onOpenChange={setAboutOpen}>
        {bio && (
          <AboutBlock label="Bio">
            <p className="whitespace-pre-wrap">{bio}</p>
          </AboutBlock>
        )}
        <AboutBlock label="Details">
          <ul className="space-y-1 text-sm text-muted-foreground">
            {username && <li>{username}</li>}
            {searchRadiusMi != null && (
              <li className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-lime" />
                {city || "Anywhere"} · travels up to {formatDistance(searchRadiusMi, unit)}
              </li>
            )}
            {!searchRadiusMi && city && <li>{city}</li>}
            {profile.graduating_class && <li>Class of {profile.graduating_class}</li>}
          </ul>
        </AboutBlock>
        <AboutBlock label="Stats">
          <AboutStats
            items={[
              { k: `${stats.reliability}%`, v: "Reliable" },
              { k: stats.sportsmanship, v: "Sport" },
              { k: stats.friends, v: "Crew" },
            ]}
          />
        </AboutBlock>
        {links.length > 0 && (
          <AboutBlock label="Links">
            <ProfileLinksList links={links} />
          </AboutBlock>
        )}
        <AboutBlock label="Reputation">
          <ReputationBadge
            rep={rep}
            onClick={() => setReviewsOpen(true)}
            ariaLabel={`Open reviews for ${displayName}. Trust score ${rep.trustScore}, ${rep.avg.toFixed(1)} out of 5 from ${rep.count} review${rep.count === 1 ? "" : "s"}.`}
          />
        </AboutBlock>
      </ProfileAboutSheet>

<div className="px-4">
        {/* About — shown directly on the card */}
        {(bio || links.length > 0 || searchRadiusMi != null || city) && (
          <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
            {bio && (
              <section>
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  About
                </h2>
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{bio}</p>
              </section>
            )}
            <section className={bio ? "mt-4" : ""}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Details
              </h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {username && <li>{username}</li>}
                {searchRadiusMi != null && (
                  <li className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-lime" />
                    {city || "Anywhere"} · travels up to {formatDistance(searchRadiusMi, unit)}
                  </li>
                )}
                {!searchRadiusMi && city && <li>{city}</li>}
                {profile.graduating_class && <li>Class of {profile.graduating_class}</li>}
              </ul>
            </section>
<div className="mt-2 border-t border-border/60 pt-1">
              <ExpandableAboutSection label="Stats">
                <AboutStats
                  items={[
                    { k: `${stats.reliability}%`, v: "Reliable" },
                    { k: stats.sportsmanship, v: "Sport" },
                    { k: stats.friends, v: "Crew" },
                  ]}
                />
              </ExpandableAboutSection>

              {links.length > 0 && (
                <ExpandableAboutSection label="Links" count={links.length}>
                  <ProfileLinksList links={links} />
                </ExpandableAboutSection>
              )}

              <ExpandableAboutSection
                label="Reputation"
                badge={
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
                    {rep.trustScore}
                  </span>
                }
              >
                <ReputationBadge
                  rep={rep}
                  onClick={() => setReviewsOpen(true)}
                  ariaLabel={`Open reviews for ${displayName}. Trust score ${rep.trustScore}, ${rep.avg.toFixed(1)} out of 5 from ${rep.count} review${rep.count === 1 ? "" : "s"}.`}
                />
              </ExpandableAboutSection>
            </div>
          </div>
        )}

        <PlayerOrgsSection userId={userId} />

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

                  {"positions" in s &&
                    Array.isArray((s as any).positions) &&
                    (s as any).positions.length > 0 && (
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
        <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
          <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0" />{" "}
          <span className="min-w-0 flex-1 whitespace-normal break-words">{window}</span>
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
        {
          event: "*",
          schema: "public",
          table: "trainer_org_members",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchRows();
        },
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trainer_orgs" }, () => {
        fetchRows();
      })
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
