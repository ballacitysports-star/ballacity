import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_MAINTENANCE,
  MAINTENANCE_SETTING_KEY,
  parseMaintenance,
  type MaintenanceConfig,
} from "@/lib/maintenance";

export function MaintenancePanel() {
  const qc = useQueryClient();
  const loadSettings = useServerFn(superadminListSettings);
  const setSetting = useServerFn(superadminSetSetting);
  const settings = useQuery({ queryKey: ["superadmin-settings"], queryFn: () => loadSettings({}) });
  const row = (settings.data?.settings ?? []).find(
    (s: { key: string }) => s.key === MAINTENANCE_SETTING_KEY,
  ) as { value: unknown } | undefined;

  const [local, setLocal] = useState<MaintenanceConfig>(DEFAULT_MAINTENANCE);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLocal(parseMaintenance(row?.value)), [row?.value]);

  async function save(next: MaintenanceConfig) {
    const prev = local;
    setLocal(next);
    setSaving(true);
    try {
      await setSetting({
        data: {
          key: MAINTENANCE_SETTING_KEY,
          value: next,
          description:
            "App-only maintenance: blocks app pages for non-staff; landing, guides, cities, legal and sign-in stay public.",
          isPublic: true,
        },
      });
      toast.success(next.enabled ? "Maintenance mode is ON" : "Maintenance settings saved");
      void qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      void qc.invalidateQueries({ queryKey: ["maintenance-config"] });
    } catch (e) {
      setLocal(prev);
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Maintenance mode (app only)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Regular users see a maintenance screen on the app. Landing page, guides, city pages,
          legal pages and sign-in stay open for search engines. Staff are never blocked.
        </p>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm font-medium">Maintenance on</span>
          <Switch
            checked={local.enabled}
            disabled={saving || settings.isLoading}
            onCheckedChange={(v) => save({ ...local, enabled: v })}
          />
        </label>
        <Textarea
          value={local.message}
          maxLength={500}
          placeholder="Optional message, e.g. Back by 9pm ET."
          onChange={(e) => setLocal({ ...local, message: e.target.value })}
        />
        <Button size="sm" variant="outline" disabled={saving} onClick={() => save(local)}>
          Save message
        </Button>
      </CardContent>
    </Card>
  );
}
