import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Building2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { liveChannel, onLive } from "@/lib/realtime-channel";

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

/**
 * The organizations a player belongs to, as chips on their public profile.
 * Row-level security shows a membership only to the member and to people in
 * the same organization, so for most visitors this renders nothing.
 *
 * Kept live over realtime. A new membership arrives through the user_id
 * filter. A removed one does not: trainer_org_members has the default replica
 * identity, so the old row Postgres logs for a DELETE holds only the primary
 * key, Realtime has no user_id to test the filter against, and the filtered
 * subscription never receives the DELETE (seen on the local stack; the chip
 * stayed until a reload). game_participants differs: it has REPLICA IDENTITY
 * FULL, so its filtered DELETEs do arrive. Here deletes are watched unfiltered
 * instead, which delivers every membership's DELETE as `{ id }` only (row-level
 * security strips the rest), and matched against the rows shown.
 *
 * The channel holds SUBSCRIBED until the changes are live, and the rows are
 * read again on every SUBSCRIBED: the read on mount may have been answered
 * before then, and a change in that gap would otherwise never show.
 */
export function PlayerOrgsSection({ userId }: { userId: string }) {
  const [rows, setRows] = useState<PlayerOrgRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const shownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    // Reads, numbered as they are sent. The read on mount, the one on SUBSCRIBED and those after
    // events can be out at once and answer in any order: an answer from a read sent earlier must
    // not replace a later one's.
    let loadsSent = 0;
    let newestLoadApplied = 0;
    const fetchRows = async () => {
      const loadNo = ++loadsSent;
      const { data } = await supabase
        .from("trainer_org_members")
        .select("id, org_id, role, org:org_id(id,name,handle,avatar,city,verified)")
        .eq("user_id", userId);
      if (cancelled || loadNo < newestLoadApplied) return;
      newestLoadApplied = loadNo;
      const next = ((data as unknown as PlayerOrgRow[]) ?? []).filter((r) => r.org);
      shownIds.current = new Set(next.map((r) => r.id));
      setRows(next);
      setLoaded(true);
    };
    fetchRows();

    // trainer_org_members and trainer_orgs are both in the supabase_realtime publication, so the
    // join can wait for their changes to be live.
    const ch = liveChannel(`player-orgs:${userId}`)
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
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "trainer_org_members" },
        (payload) => {
          const id = (payload.old as { id?: string } | null)?.id;
          if (id && shownIds.current.has(id)) fetchRows();
        },
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trainer_orgs" }, () => {
        fetchRows();
      })
      .subscribe(onLive(() => void fetchRows()));

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
            <span className="micro-label text-muted-foreground">{r.role}</span>
          </Link>
        );
      })}
    </div>
  );
}
