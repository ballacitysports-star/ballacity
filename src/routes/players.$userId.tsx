import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MessageCircle, Loader2, Calendar, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { SPORTS } from "@/lib/sample-data";
import { kmToMi } from "@/lib/distance";
import type { PlayerAvailability } from "@/lib/availability";

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
};

function PlayerProfilePage() {
  const { userId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [availability, setAvailability] = useState<PlayerAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, avatar_initials, bio, sport, username")
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

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-24">
      <Link to="/players" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to players
      </Link>

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface/40" />
      ) : !profile ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
          <p className="font-semibold">Player not found</p>
          <p className="text-sm text-muted-foreground mt-1">This profile may have been removed.</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-lime-gradient font-bold text-primary-foreground text-lg">
                {profile.avatar_initials ?? profile.display_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-xl font-bold truncate">{profile.display_name}</h1>
                {profile.username && <p className="text-xs text-muted-foreground">@{profile.username}</p>}
                {profile.sport && (
                  <p className="text-xs text-muted-foreground mt-1">Plays {profile.sport}</p>
                )}
              </div>
            </div>
            {profile.bio && (
              <p className="mt-4 text-sm leading-snug whitespace-pre-wrap">{profile.bio}</p>
            )}
            {user?.id !== profile.id && (
              <Button
                onClick={handleMessage}
                disabled={opening}
                className="mt-5 w-full rounded-full bg-lime-gradient text-primary-foreground"
              >
                {opening ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-1" />}
                Message
              </Button>
            )}
          </div>

          {availability && (
            <>
              <h2 className="mt-6 mb-2 font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Open availability
              </h2>
              <PlayerCard a={availability} />
            </>
          )}
        </>
      )}
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
