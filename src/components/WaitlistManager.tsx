import { useEffect, useMemo, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/UserAvatar";
import { PlayerReliabilityBadge } from "@/components/games/PlayerReliabilityBadge";
import { createNotification } from "@/lib/notifications";
import { reviewWaitlistEntry, type WaitlistEntry, type WaitlistStatus } from "@/lib/waitlist-store";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_initials: string | null;
  avatar_url: string | null;
};

function useWaitlistProfiles(userIds: string[]) {
  const key = userIds.slice().sort().join(",");
  const [map, setMap] = useState<Record<string, Profile>>({});
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_initials, avatar_url")
        .in("id", ids);
      if (cancelled || !data) return;
      const next: Record<string, Profile> = {};
      for (const p of data as Profile[]) next[p.id] = p;
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return map;
}

export function WaitlistStatusPill({ status }: { status: WaitlistStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-[10px] font-bold text-lime">
        <Check className="h-3 w-3" /> Approved
      </span>
    );
  }
  if (status === "offered") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-[10px] font-bold text-lime">
        <Clock className="h-3 w-3" /> Spot offered
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
        <X className="h-3 w-3" /> Offer expired
      </span>
    );
  }
  if (status === "declined") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
        <X className="h-3 w-3" /> Declined
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-coral/20 px-2 py-0.5 text-[10px] font-bold text-coral">
      <Clock className="h-3 w-3" /> Waiting
    </span>
  );
}

/**
 * Waitlist list for one position. Hosts get Approve / Decline actions so they
 * can promote waiting players as slots free up; everyone else sees status only.
 */
export function WaitlistManager({
  entries,
  isHost,
  gameTitle,
  gameId,
  spotsLeft,
}: {
  entries: WaitlistEntry[];
  isHost: boolean;
  gameTitle: string;
  gameId: string;
  spotsLeft: number;
}) {
  const ids = useMemo(() => entries.map((e) => e.userId), [entries]);
  const profiles = useWaitlistProfiles(ids);
  const [busy, setBusy] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const review = async (entry: WaitlistEntry, status: Exclude<WaitlistStatus, "waiting">) => {
    setBusy(entry.id);
    try {
      await reviewWaitlistEntry(entry.id, status);
      toast.success(
        status === "approved"
          ? "Approved — the player can now claim the spot."
          : "Waitlist request declined.",
      );
      void createNotification({
        user_id: entry.userId,
        type: status === "approved" ? "waitlist_approved" : "waitlist_declined",
        title:
          status === "approved"
            ? `You're approved for ${entry.position}`
            : `Your ${entry.position} waitlist request was declined`,
        body: gameTitle,
        link: `/games/${gameId}`,
      }).catch(() => {});
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update the waitlist.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="section-eyebrow text-coral">Waitlist · {entries.length}</span>
        {isHost && spotsLeft > 0 && (
          <span className="text-[10px] font-semibold text-lime">
            {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} free
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {entries.map((e, i) => {
          const p = profiles[e.userId];
          const name = p?.display_name || "Player";
          return (
            <div key={e.id} className="flex items-center gap-2">
              <span className="w-4 text-[10px] font-bold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <UserAvatar
                name={name}
                initials={p?.avatar_initials ?? undefined}
                avatarUrl={p?.avatar_url ?? undefined}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm">{name}</span>
                {isHost && <PlayerReliabilityBadge userId={e.userId} className="mt-0.5" />}
              </div>
              {isHost && e.status === "waiting" ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busy === e.id}
                    onClick={() => void review(e, "approved")}
                    aria-label={`Approve ${name} for ${e.position}`}
                    className="rounded-full border border-lime bg-lime px-2.5 py-1 text-[11px] font-bold text-background hover:opacity-90 active:scale-95 transition disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy === e.id}
                    onClick={() => void review(e, "declined")}
                    aria-label={`Decline ${name} for ${e.position}`}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground hover:bg-secondary active:scale-95 transition disabled:opacity-60"
                  >
                    Decline
                  </button>
                </div>
              ) : (
                <WaitlistStatusPill status={e.status} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
