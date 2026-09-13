import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ListOrdered } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMyWaitlist } from "@/lib/waitlist-store";
import { WaitlistStatusPill } from "@/components/WaitlistManager";

/**
 * "My waitlist" card: every position the signed-in user is waiting on, with the
 * host's approval status (waiting / approved / declined).
 */
export function MyWaitlistCard() {
  const { entries, loading } = useMyWaitlist();
  const [titles, setTitles] = useState<Record<string, string>>({});
  const ids = entries.map((e) => e.gameId).join(",");

  useEffect(() => {
    const gameIds = ids ? Array.from(new Set(ids.split(","))) : [];
    if (gameIds.length === 0) {
      setTitles({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("hosted_games").select("id, title").in("id", gameIds);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const g of data as Array<{ id: string; title: string }>) next[g.id] = g.title;
      setTitles(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  if (loading || entries.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-2xl border border-coral/30 bg-coral/10 text-coral">
          <ListOrdered className="h-4 w-4" />
        </span>
        <div>
          <h2 className="section-eyebrow text-foreground">My waitlist</h2>
          <p className="text-[10px] text-muted-foreground">Approval status from each host</p>
        </div>
      </div>
      <div className="space-y-2">
        {entries.map((e) => (
          <Link
            key={e.id}
            to="/games/$gameId"
            params={{ gameId: e.gameId }}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-coral/40"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{titles[e.gameId] ?? "Game"}</div>
              <div className="text-[11px] text-muted-foreground">
                {e.position}
                {e.status === "approved"
                  ? " · spot offered — open the game to claim it"
                  : e.status === "declined"
                    ? " · host declined this request"
                    : " · waiting for the host"}
              </div>
            </div>
            <WaitlistStatusPill status={e.status} />
          </Link>
        ))}
      </div>
    </section>
  );
}
