import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Building2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
 * filter. A removed one does not: Realtime cannot apply a filter to a DELETE
 * on this table (its old row carries only the primary key), so a filtered
 * subscription never hears about it and the chip stayed until a reload. Deletes
 * are therefore watched unfiltered and matched against the rows shown.
 */
export function PlayerOrgsSection({ userId }: { userId: string }) {
  const [rows, setRows] = useState<PlayerOrgRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const shownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const fetchRows = async () => {
      const { data } = await supabase
        .from("trainer_org_members")
        .select("id, org_id, role, org:org_id(id,name,handle,avatar,city,verified)")
        .eq("user_id", userId);
      if (cancelled) return;
      const next = ((data as unknown as PlayerOrgRow[]) ?? []).filter((r) => r.org);
      shownIds.current = new Set(next.map((r) => r.id));
      setRows(next);
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
            <span className="micro-label text-muted-foreground">{r.role}</span>
          </Link>
        );
      })}
    </div>
  );
}
