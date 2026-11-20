import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorCode, userErrorMessage } from "@/lib/user-error";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";
import {
  HOME_AVAILABILITY_SETTING_KEY,
  parseHomeAvailabilitySetting,
} from "@/lib/home-availability";

/**
 * WP 1.6: the switch for the availability-first Home (the "I'm available" card and the four shortcuts at the top of
 * /feed). On when the row is missing; turning it off hides the section for every member at their next load. Saved to
 * the public app_settings row and recorded in the audit log by superadminSetSetting.
 */
export function HomeAvailabilityPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(superadminListSettings);
  const setFn = useServerFn(superadminSetSetting);
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => listFn(),
  });
  const row = ((data?.settings ?? []) as { key: string; value: unknown }[]).find(
    (s) => s.key === HOME_AVAILABILITY_SETTING_KEY,
  );
  const on = parseHomeAvailabilitySetting(row?.value);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setFn({
        data: {
          key: HOME_AVAILABILITY_SETTING_KEY,
          value: { enabled: next },
          isPublic: true,
          description: 'WP 1.6: the availability-first top of Home. On unless {"enabled": false}.',
          reason: `${next ? "Turned on" : "Turned off"} the availability-first Home in Super admin`,
        },
      });
      await qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      await qc.invalidateQueries({ queryKey: ["home-availability-switch"] });
      toast.success(`Availability-first Home ${next ? "is on" : "is off"}`);
    } catch (e) {
      // Superadmin only: no raw SQL, but the code (when there is one) helps support (WP 4.0).
      const code = errorCode(e);
      toast.error(
        `${userErrorMessage(e, "Couldn't save this setting. Please try again.")}${code ? ` (${code})` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Availability-first Home</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            The &ldquo;I&rsquo;m available&rdquo; card and the Find players, Find games, My games
            and Invitations shortcuts at the top of Home. On unless switched off here; the feed
            below never changes. Members see the change at their next load.
          </p>
          <Switch
            checked={on}
            disabled={isLoading || busy}
            onCheckedChange={(v) => void toggle(v)}
            aria-label="Availability-first Home"
          />
        </div>
      </CardContent>
    </Card>
  );
}
