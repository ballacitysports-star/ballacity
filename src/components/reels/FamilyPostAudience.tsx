/**
 * "Who can watch" for a family post (a parent's clip of their under-13 child).
 *
 * Private is the default and means only you, plus your child on their own account
 * (read-only, which you can turn off in the Parent Center). You can also pick ONE
 * team of your child's: its verified members and coaching staff can then watch,
 * and only while your child is on it. There is no public option for this age.
 * Shown only while team sharing is switched on.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { toast } from "sonner";
import {
  getTeamShareEnabled,
  listFamilyPostTeams,
  setFamilyPostTeam,
} from "@/lib/family-clips.functions";

export function FamilyPostAudience({ reelId }: { reelId: string }) {
  const qc = useQueryClient();
  const enabledFn = useServerFn(getTeamShareEnabled);
  const teamsFn = useServerFn(listFamilyPostTeams);
  const setFn = useServerFn(setFamilyPostTeam);

  const { data: enabled } = useQuery({
    queryKey: ["family-team-share-enabled", reelId],
    queryFn: () => enabledFn({ data: { reelId } }),
    staleTime: 60_000,
  });
  const { data: choices, isFetching } = useQuery({
    queryKey: ["family-post-teams", reelId],
    queryFn: () => teamsFn({ data: { reelId } }),
    enabled: enabled?.enabled === true,
  });

  if (!enabled?.enabled) return null;

  async function change(teamId: string) {
    try {
      await setFn({ data: { reelId, teamId: teamId || null } });
      toast.success(teamId ? "Your team can now watch this clip" : "This clip is private again");
      await qc.invalidateQueries({ queryKey: ["family-post-teams", reelId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update who can watch");
    }
  }

  const teams = choices?.teams ?? [];
  return (
    <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
      <p className="inline-flex items-center gap-1.5 section-eyebrow text-lime">
        <Users className="h-3.5 w-3.5" /> Who can watch
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Private by default: you, and your child on their own account. You can also share with one
        of your child&apos;s teams. Its coaches and verified teammates can watch, only while your
        child is on the team. This clip is never public.
      </p>
      <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Share with a team
        <select
          value={choices?.selected ?? ""}
          onChange={(e) => change(e.target.value)}
          disabled={isFetching}
          className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground"
        >
          <option value="">No team (private)</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {teams.length === 0 && !isFetching && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Your child isn&apos;t on a team yet.
        </p>
      )}
    </div>
  );
}
