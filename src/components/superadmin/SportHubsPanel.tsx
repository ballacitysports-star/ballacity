/**
 * Sport hubs: the display switch and aggregate activity per sport.
 *
 * The switch is the public `sport_hubs` app_settings row. It must be saved with
 * isPublic: true: anonymous visitors only read public rows, so a private row
 * would leave the hubs on whatever it says. A missing row counts as on.
 * The switch only hides the hub pages; it grants and removes no permissions.
 *
 * Activity is counts only, with small counts masked (see sport-activity.ts).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  superadminListSettings,
  superadminSetSetting,
  superadminSportActivity,
} from "@/lib/superadmin.functions";
import { SPORT_ACTIVITY_MIN, type MaskedCount } from "@/lib/sport-activity";

const show = (c: MaskedCount) => (c.small ? `<${SPORT_ACTIVITY_MIN}` : String(c.value));

export function SportHubsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(superadminListSettings);
  const setFn = useServerFn(superadminSetSetting);
  const activityFn = useServerFn(superadminSportActivity);
  const [busy, setBusy] = useState(false);

  const settings = useQuery({ queryKey: ["superadmin-settings"], queryFn: () => listFn() });
  const activity = useQuery({
    queryKey: ["superadmin-sport-activity"],
    queryFn: () => activityFn(),
  });

  const row = ((settings.data?.settings ?? []) as { key: string; value: unknown }[]).find(
    (s) => s.key === "sport_hubs",
  );
  const on = (row?.value as { enabled?: unknown } | undefined)?.enabled !== false;

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setFn({
        data: {
          key: "sport_hubs",
          value: { enabled: next },
          isPublic: true,
          reason: `${next ? "Turned on" : "Turned off"} sport hubs in Super admin`,
        },
      });
      await qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      toast.success(`Sport hubs ${next ? "are on" : "are off"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save this setting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
      aria-label="Sport hubs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Sport hubs</h3>
          <p className="text-xs text-muted-foreground">
            Public pages at /basketball, /baseball and the other sports. Turning them off hides the
            pages only; no data or permissions change.
          </p>
        </div>
        <Switch
          checked={on}
          disabled={busy || settings.isLoading}
          onCheckedChange={toggle}
          aria-label="Sport hubs"
        />
      </div>

      {activity.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading activity…</p>
      ) : activity.error ? (
        <p className="text-sm text-destructive">Could not load sport activity.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="pb-1 text-left text-muted-foreground">
              Counts only. Under {SPORT_ACTIVITY_MIN} is hidden.
            </caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-semibold">
                  Sport
                </th>
                <th scope="col" className="py-1 pr-3 font-semibold">
                  Games created (30d)
                </th>
                <th scope="col" className="py-1 pr-3 font-semibold">
                  Upcoming games
                </th>
                <th scope="col" className="py-1 font-semibold">
                  Teams
                </th>
              </tr>
            </thead>
            <tbody>
              {activity.data?.rows.map((r) => (
                <tr key={r.sport} className="border-t border-border/60">
                  <th scope="row" className="py-1 pr-3 font-medium">
                    {r.sport}
                  </th>
                  <td className="py-1 pr-3">{show(r.gamesCreated30d)}</td>
                  <td className="py-1 pr-3">{show(r.upcomingGames)}</td>
                  <td className="py-1">{show(r.teams)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
