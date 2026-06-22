import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { Button } from "@/components/ui/button";

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
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("profiles")
      .select("id, display_name, avatar_initials, bio, sport, username")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast.error(error.message);
        setProfile((data as ProfileRow) ?? null);
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
      )}
    </div>
  );
}
