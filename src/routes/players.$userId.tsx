import { createFileRoute, Link, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, MessageCircle, Loader2, Calendar, MapPin, Shield, Trophy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { SPORTS, HERO_IMAGE } from "@/lib/sample-data";
import { kmToMi } from "@/lib/distance";
import type { PlayerAvailability } from "@/lib/availability";
import { ReviewsSection } from "@/components/ReviewsSection";
import { ReputationBadge } from "@/components/ReputationBadge";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { useProfileOverrides } from "@/lib/user-prefs-store";
import { ProfileLinksList } from "@/components/ProfileLinks";

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
  avatar_url: string | null;
  cover_url: string | null;
  birthday: string | null;
  graduating_class: number | null;
  links: any;
};

function PlayerProfilePage() {
  const { userId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [availability, setAvailability] = useState<PlayerAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const overrides = useProfileOverrides(userId);
  const reviews = useReviewsFor(userId);
  const rep = useMemo(() => computeReputation(reviews, "player"), [reviews]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, avatar_initials, bio, sport, username, city, avatar_url, cover_url, birthday, graduating_class, links")
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
      setAvailability((avail.data as unknown as PlayerAvailability) ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId]);

  // If viewing your own card, redirect to the full profile page
  if (user && user.id === userId) {
    return <Navigate to="/profile" />;
  }

  const handleMessage = async () => {
    if (!user) { toast.error("Sign in to message this player."); return; }
    setOpening(true);
    try {
      const id = await getOrCreateDirectConversation(userId);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (e: any) {
      toast.error(e.message || "Couldn't open chat");
    } finally { setOpening(false); }
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
        <Link to="/players" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to players
        </Link>
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
          <p className="font-semibold">Player not found</p>
          <p className="text-sm text-muted-foreground mt-1">This profile may have been removed.</p>
        </div>
      </div>
    );
  }

  const initials = overrides.avatar || profile.avatar_initials || profile.display_name.slice(0, 2).toUpperCase();
  const displayName = overrides.name || profile.display_name;
  const username = (overrides.username || (profile.username ? `@${profile.username.replace(/^@/, "")}` : "")).trim();
  const bio = overrides.bio ?? profile.bio ?? "";
  const city = overrides.city ?? profile.city ?? "";
  const sportsList = overrides.sports?.length
    ? overrides.sports
    : availability?.sports?.length
      ? availability.sports.map((name) => ({ name, skill: 3 }))
      : profile.sport
        ? [{ name: profile.sport as any, skill: 3 }]
        : [];
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
          className="grid h-24 w-24 place-items-center overflow-hidden rounded-3xl border-4 border-background bg-lime-gradient font-display text-3xl font-bold text-primary-foreground glow-lime"
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
              {(() => { const a = ageFrom(profile.birthday ?? undefined); return a != null ? (
                <span className="text-sm font-normal text-muted-foreground shrink-0">· {a}</span>
              ) : null; })()}
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime shrink-0">
                <Shield className="h-3 w-3" /> Verified
              </span>
            </h1>
            <div className="text-sm text-muted-foreground truncate">
              {[username, city].filter(Boolean).join(" · ")}
            </div>
            {(profile.birthday || profile.graduating_class) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {profile.birthday && (
                  <span>🎂 {formatBirthday(profile.birthday)}{ageFrom(profile.birthday) != null ? ` · ${ageFrom(profile.birthday)} yrs` : ""}</span>
                )}
                {profile.graduating_class && <span>🎓 Class of {profile.graduating_class}</span>}
              </div>
            )}
          </div>
          <Button
            onClick={handleMessage}
            disabled={opening}
            className="shrink-0 rounded-full bg-lime-gradient text-primary-foreground"
            size="sm"
          >
            {opening ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-1" />}
            Message
          </Button>
        </div>

        {bio && (
          <p className="mt-3 text-sm text-foreground/90 whitespace-pre-wrap">{bio}</p>
        )}

        {/* Profile links */}
        {links.length > 0 && (
          <div className="mt-3">
            <ProfileLinksList links={links} />
          </div>
        )}

        {/* Stats */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {[
            { k: stats.played, v: "Games" },
            { k: stats.reliability + "%", v: "Reliable" },
            { k: stats.sportsmanship, v: "Sport" },
            { k: stats.friends, v: "Crew" },
          ].map((s) => (
            <div key={s.v} className="rounded-2xl border border-border bg-surface p-3 text-center">
              <div className="font-display text-lg font-bold">{s.k}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </div>

        {/* Reputation badge */}
        <div className="mt-4">
          <ReputationBadge rep={rep} />
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

        {/* Sports & skill */}
        {sportsList.length > 0 && (
          <div className="mt-6">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Sports</h2>
            <div className="space-y-2">
              {sportsList.map((s) => (
                <div key={s.name} className="rounded-2xl border border-border bg-surface p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">
                      {SPORTS.find((sp) => sp.name === s.name)?.emoji ?? "🎯"} {s.name}
                    </span>
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
        )}

        {/* Badges */}
        {badges.length > 0 && (
          <div className="mt-6">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Trophy className="h-4 w-4" /> Badges
            </h2>
            <div className="flex flex-wrap gap-2">
              {badges.map((b) => (
                <span key={b} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold">
                  {b}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Reviews */}
        <div className="mt-6">
          <ReviewsSection
            revieweeId={userId}
            revieweeKind="player"
            revieweeName={displayName}
            isOwner={false}
          />
        </div>
      </div>
    </div>
  );
}


function PlayerCard({ a }: { a: PlayerAvailability }) {
  const window = formatWindow(a);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Looking to play</span>
        <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">{a.skill_level}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {a.sports.length === 0 ? (
          <span className="text-xs text-muted-foreground">Any sport</span>
        ) : a.sports.map((s) => {
          const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
          return (
            <span key={s} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold">
              {emoji} {s}
            </span>
          );
        })}
      </div>
      {window && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" /> {window}
        </p>
      )}
      {(a.city || a.travel_radius_km) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {a.city || "Anywhere"} · up to {kmToMi(a.travel_radius_km)} mi
        </p>
      )}
      {a.note && <p className="mt-3 text-sm leading-snug">{a.note}</p>}
    </div>
  );
}

function formatWindow(a: PlayerAvailability): string {
  const parts: string[] = [];
  if (a.starts_on || a.ends_on) {
    const s = a.starts_on ? fmtDate(a.starts_on) : "";
    const e = a.ends_on ? fmtDate(a.ends_on) : "";
    if (s && e) parts.push(s === e ? s : `${s} – ${e}`);
    else parts.push(s || e);
  }
  if (a.recurring_days.length) parts.push(a.recurring_days.join(" · "));
  return parts.join(" · ");
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
