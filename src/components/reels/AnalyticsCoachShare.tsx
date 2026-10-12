/**
 * Share Pro Analytics with the coaches of a team. Off until someone turns it on.
 * Used in two places: an athlete's own Reels page (adults and 16-17 choose), and a
 * guardian's Parent Center for a child aged 13-15. A 13-15 athlete sees it read-only.
 * Hidden when the feature is off, for under-13s, or when there is no team.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  getCoachAnalyticsEnabled,
  listAnalyticsShares,
  setAnalyticsShare,
} from "@/lib/coach-analytics.functions";

export function AnalyticsCoachShare({
  childUserId,
  childName,
  className = "",
}: {
  /** Set by a guardian managing a child; omitted on an athlete's own page. */
  childUserId?: string;
  childName?: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const enabledFn = useServerFn(getCoachAnalyticsEnabled);
  const listFn = useServerFn(listAnalyticsShares);
  const setFn = useServerFn(setAnalyticsShare);
  const key = ["analytics-shares", childUserId ?? "me"];

  const { data: on } = useQuery({
    queryKey: ["coach-analytics-enabled"],
    queryFn: () => enabledFn(),
    staleTime: 60_000,
  });
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { userId: childUserId } }),
    enabled: on?.enabled === true,
    retry: false,
  });

  if (on?.enabled !== true || !data || data.mode === "unavailable" || data.teams.length === 0) {
    return null;
  }
  const canChange = (data.mode === "self" && !childUserId) || (data.mode === "guardian" && !!childUserId);
  const who = childName ?? "you";

  return (
    <div className={`rounded-xl border border-border p-3 ${className}`}>
      <div className="text-sm font-semibold">
        {childUserId ? `Share ${childName}'s analytics with coaches` : "Share my analytics with my coaches"}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Coaches of a team you choose can see {childUserId ? "their" : "your"} Pro Analytics ratings
        and coaching cues, never the video. Off until turned on, and you can turn it off any time.
      </p>
      {!canChange && (
        <p className="mt-2 text-xs font-semibold text-amber-300">
          A parent or guardian controls this for {who === "you" ? "you" : who}.
        </p>
      )}
      <ul className="mt-2 divide-y divide-border/50">
        {data.teams.map((t) => (
          <li key={t.teamId} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
            <Switch
              checked={t.shared}
              disabled={!canChange}
              onCheckedChange={async (v) => {
                try {
                  await setFn({ data: { userId: childUserId, teamId: t.teamId, enabled: v } });
                  await qc.invalidateQueries({ queryKey: key });
                  toast.success(v ? `Shared with ${t.name} coaches` : "Sharing turned off");
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not save this setting");
                }
              }}
              aria-label={`Share analytics with ${t.name} coaches`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
