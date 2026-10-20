import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Share2, Star, UserPlus, Users } from "lucide-react";
import { ensureOrgById } from "@/lib/org-store";
import { getTrainerOrg } from "@/lib/trainer-orgs.functions";
import { GAMES, HERO_IMAGE, type Game, type Org } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { GameCard } from "@/components/GameCard";
import { ReviewsSection } from "@/components/ReviewsSection";
import { computeReputation } from "@/lib/reviews";
import { useReviewsFor } from "@/lib/reviews-db";
import { ChannelTabs } from "@/components/profile/ChannelTabs";
import {
  ChannelPill,
  ProfileChannelHeader,
  channelPillClass,
} from "@/components/profile/ProfileChannelHeader";
import { ProfileAboutSheet, AboutBlock, AboutStats } from "@/components/profile/ProfileAboutSheet";
import { ACCOUNT_TYPE_META } from "@/lib/account-type";
import type { AccountProfile } from "@/lib/account-profiles";
import { isImageUrl } from "@/components/OrgAvatarMark";
import { hideFinishedGames } from "@/lib/game-time";
import { collapseSeriesGames } from "@/lib/game-series";
import { InvitePlayerDialog } from "@/components/team/InvitePlayerDialog";
import { TeamRosterPanel } from "@/components/team/TeamRosterPanel";
import { useTeamRoster } from "@/lib/team-roster";
import { ProfileShareCard } from "@/components/ProfileShareCard";

type ViewModel = {
  name: string;
  handle: string | null;
  bannerUrl: string | null;
  avatarUrl: string | null;
  avatarFallback: string;
  city: string | null;
  bio: string | null;
  sports: string[];
  members: number | null;
  editTo: { to: string; params: Record<string, string | undefined> };
  publicTo: { to: string; params: Record<string, string | undefined> };
  /** Public URL path, for sharing. */
  publicPath: string;
};

/**
 * The Profile tab rendered for a non-player active profile (team, trainer, or
 * gym). Shows that profile's identity, the games it hosts, and its reviews so
 * switching profiles visibly changes what the app is acting as.
 */
export function ActiveProfileView({ profile }: { profile: AccountProfile }) {
  const isGym = profile.kind === "gym";
  const isTeam = profile.kind === "team";
  const refId = profile.refId ?? "";

  const teamQuery = useQuery({
    queryKey: ["org", refId],
    queryFn: () => ensureOrgById(refId),
    enabled: !isGym && !!refId,
    staleTime: 30_000,
  });
  const gymQuery = useQuery({
    queryKey: ["trainer-org", refId],
    queryFn: () => getTrainerOrg({ data: { id: refId } }),
    enabled: isGym && !!refId,
    staleTime: 30_000,
  });

  // The real roster (team_members), so the member count matches the Roster tab.
  const roster = useTeamRoster(isTeam && refId ? refId : undefined);

  const hosted = useHostedGames();
  const games: Game[] = useMemo(() => {
    const pool = hideFinishedGames([...hosted, ...GAMES]);
    const seen = new Set<string>();
    const mine = pool
      .filter((g) => (isGym ? g.orgId === refId : g.teamId === refId))
      .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
    // One card per multi-day series (its next session), like the Feed.
    return collapseSeriesGames(mine, "upcoming");
  }, [hosted, isGym, refId]);

  const reviews = useReviewsFor(refId);
  const revieweeKind: "trainer" | "team" = profile.kind === "trainer" ? "trainer" : "team";
  const rep = useMemo(() => computeReputation(reviews, revieweeKind), [reviews, revieweeKind]);

  const [tab, setTab] = useState<"games" | "roster" | "reviews">("games");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const vm: ViewModel | null = useMemo(() => {
    if (isGym) {
      const org = gymQuery.data?.org as
        | {
            id: string;
            name: string;
            handle: string | null;
            bio: string | null;
            city: string | null;
            avatar: string | null;
            avatar_url: string | null;
            cover_url?: string | null;
            sports?: string[] | null;
          }
        | undefined;
      if (!org) return null;
      return {
        name: org.name,
        handle: org.handle ?? null,
        bannerUrl: org.cover_url ?? null,
        avatarUrl: org.avatar_url ?? (isImageUrl(org.avatar) ? org.avatar : null),
        avatarFallback: isImageUrl(org.avatar)
          ? profile.avatarFallback
          : org.avatar || profile.avatarFallback,
        city: org.city ?? null,
        bio: org.bio ?? null,
        sports: org.sports ?? [],
        members: gymQuery.data?.members?.length ?? null,
        editTo: { to: "/orgs/$orgId/edit", params: { orgId: org.id } },
        publicTo: { to: "/orgs/$orgId", params: { orgId: org.id } },
        publicPath: `/orgs/${org.id}`,
      };
    }
    const org = teamQuery.data as Org | undefined;
    if (!org) return null;
    const isTrainer = profile.kind === "trainer";
    return {
      name: org.name,
      handle: org.handle ?? null,
      bannerUrl: org.cover ?? null,
      // Teams/trainers store an uploaded logo as a URL in `avatar`; never
      // print that URL as text.
      avatarUrl: isImageUrl(org.avatar) ? org.avatar : null,
      avatarFallback: isImageUrl(org.avatar)
        ? profile.avatarFallback
        : org.avatar || profile.avatarFallback,
      city: org.city ?? null,
      bio: org.bio ?? org.tagline ?? null,
      sports: org.sports ?? [],
      members: roster.data?.length ?? org.roster ?? null,
      editTo: isTrainer
        ? { to: "/trainers/$trainerId/edit", params: { trainerId: org.id } }
        : { to: "/teams/$teamId/edit", params: { teamId: org.id } },
      publicTo: isTrainer
        ? { to: "/trainers/$trainerId", params: { trainerId: org.id } }
        : { to: "/teams/$teamId", params: { teamId: org.id } },
      publicPath: isTrainer ? `/trainers/${org.id}` : `/teams/${org.id}`,
    };
  }, [isGym, gymQuery.data, teamQuery.data, roster.data, profile.kind, profile.avatarFallback]);

  const meta = ACCOUNT_TYPE_META[profile.kind];

  if (!vm) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        Loading {meta.label.toLowerCase()} profile…
      </div>
    );
  }

  return (
    <>
      <ProfileChannelHeader
        bannerUrl={vm.bannerUrl ?? HERO_IMAGE}
        avatarUrl={vm.avatarUrl}
        avatarFallback={vm.avatarFallback}
        avatarShape={profile.kind === "trainer" ? "circle" : "logo"}
        name={vm.name}
        nameBadge={
          <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
            {meta.label}
          </span>
        }
        meta={[
          vm.handle,
          vm.city,
          vm.members != null ? `${vm.members} member${vm.members === 1 ? "" : "s"}` : null,
          `${games.length} game${games.length === 1 ? "" : "s"}`,
        ].filter(Boolean)}
        description={vm.bio}
        onOpenAbout={() => setAboutOpen(true)}
        actions={
          <>
            <Link
              to={vm.editTo.to}
              params={vm.editTo.params as never}
              className={channelPillClass("primary")}
            >
              Edit {meta.label.toLowerCase()}
            </Link>
            {/* Growing the roster and spreading the link come first for a new
                team; the rest stay one swipe along the row. */}
            {isTeam && (
              <ChannelPill onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" /> Invite players
              </ChannelPill>
            )}
            <ChannelPill onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4" /> Share
            </ChannelPill>
            <Link to="/create" className={channelPillClass()}>
              Host a game
            </Link>
            <Link
              to={vm.publicTo.to}
              params={vm.publicTo.params as never}
              className={channelPillClass()}
            >
              View public page
            </Link>
            <ChannelPill onClick={() => setAboutOpen(true)}>About</ChannelPill>
          </>
        }
      />

      {isTeam && refId && (
        <InvitePlayerDialog
          teamId={refId}
          teamName={vm.name}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      )}
      <ProfileShareCard
        open={shareOpen}
        onOpenChange={setShareOpen}
        data={{
          kind: profile.kind,
          path: vm.publicPath,
          displayName: vm.name,
          username: vm.handle ?? undefined,
          initials: vm.avatarFallback,
          avatarUrl: vm.avatarUrl ?? undefined,
          bio: vm.bio ?? undefined,
          city: vm.city ?? undefined,
          sports: vm.sports.map((name) => ({ name })),
          reviewCount: rep.count,
        }}
      />

      <ProfileAboutSheet open={aboutOpen} onOpenChange={setAboutOpen}>
        {vm.bio && (
          <AboutBlock label="About">
            <p className="whitespace-pre-wrap">{vm.bio}</p>
          </AboutBlock>
        )}
        <AboutBlock label="Details">
          <ul className="space-y-1 text-sm text-muted-foreground">
            {vm.handle && <li>{vm.handle}</li>}
            {vm.city && (
              <li className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {vm.city}
              </li>
            )}
            {vm.sports.length > 0 && <li>{vm.sports.join(" · ")}</li>}
          </ul>
        </AboutBlock>
        <AboutBlock label="Stats">
          <AboutStats
            items={[
              { k: String(games.length), v: "Games" },
              { k: vm.members != null ? String(vm.members) : "—", v: "Members" },
              { k: String(rep.count), v: "Reviews" },
            ]}
          />
        </AboutBlock>
      </ProfileAboutSheet>

      <div className="px-4">
        <ChannelTabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          tabs={[
            { k: "games" as const, label: "Games", count: games.length },
            ...(isTeam
              ? [{ k: "roster" as const, label: "Roster", count: roster.data?.length }]
              : []),
            { k: "reviews" as const, label: "Reviews", count: rep.count },
          ]}
        />

        <section className={`mt-6 ${tab === "games" ? "" : "hidden"}`}>
          {games.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted-foreground">
              No games hosted under {vm.name} yet.{" "}
              <Link
                to="/create"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Host a game
              </Link>
              .
            </div>
          ) : (
            <div className="space-y-3">
              {games.map((g) => (
                <GameCard key={g.id} game={g} />
              ))}
            </div>
          )}
        </section>

        {isTeam && refId && (
          <section className={tab === "roster" ? "" : "hidden"}>
            <TeamRosterPanel teamId={refId} teamName={vm.name} />
          </section>
        )}

        <section className={`mt-6 ${tab === "reviews" ? "" : "hidden"}`}>
          {vm.members != null && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {vm.members} member
              {vm.members === 1 ? "" : "s"}
              <span aria-hidden>·</span>
              <Star className="h-3.5 w-3.5" /> {rep.count} review{rep.count === 1 ? "" : "s"}
            </p>
          )}
          <ReviewsSection
            revieweeId={refId}
            revieweeKind={revieweeKind}
            revieweeName={vm.name}
            isOwner
          />
        </section>
      </div>
    </>
  );
}
