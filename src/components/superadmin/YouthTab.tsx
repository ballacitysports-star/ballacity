import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { superadminSetSetting } from "@/lib/superadmin.functions";
import { useYouthFlags } from "@/lib/youth-features";
import {
  COPPA_DISCLAIMER,
  LEGAL_REVIEW_REQUIRED,
  MINIMUM_AGE,
  YOUTH_FLAG_KEYS,
  YOUTH_FLAG_META,
  type YouthFlagKey,
  type YouthFlags,
} from "@/lib/age-policy";

/**
 * Youth features administration. Every switch defaults to OFF; the master
 * switch gates all sub-controls. Superadmin permission is enforced by the
 * server function (and the settings table's RLS policies).
 */
export function YouthTab() {
  const { flags, loading, refetch } = useYouthFlags();
  const setSetting = useServerFn(superadminSetSetting);
  const [local, setLocal] = useState<YouthFlags>(flags);
  const [saving, setSaving] = useState<YouthFlagKey | null>(null);

  useEffect(() => {
    if (!loading) setLocal(flags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, JSON.stringify(flags)]);

  const update = async (key: YouthFlagKey, value: boolean) => {
    const next: YouthFlags = { ...local, [key]: value };
    // Turning the master switch off deactivates every sub-control.
    if (key === "enabled" && !value) {
      for (const k of YOUTH_FLAG_KEYS) if (k !== "enabled") next[k] = false;
    }
    setLocal(next);
    setSaving(key);
    try {
      await setSetting({
        data: {
          key: "youth_features",
          value: next,
          description: `${LEGAL_REVIEW_REQUIRED} — youth (under ${MINIMUM_AGE}) functionality.`,
          isPublic: true,
        },
      });
      toast.success(`${YOUTH_FLAG_META[key].label} ${value ? "enabled" : "disabled"}`);
      void refetch();
    } catch (e) {
      setLocal(local);
      toast.error(e instanceof Error ? e.message : "Could not save setting");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          <span className="text-sm font-semibold">{LEGAL_REVIEW_REQUIRED}</span>
        </div>
        <p className="text-xs text-muted-foreground">{COPPA_DISCLAIMER}</p>
        <p className="text-xs text-muted-foreground">
          OpenRun is configured for members aged {MINIMUM_AGE}+. Accounts under {MINIMUM_AGE} are
          refused by the database until youth features are explicitly enabled here.
        </p>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {YOUTH_FLAG_KEYS.map((key) => {
          const meta = YOUTH_FLAG_META[key];
          const master = key === "enabled";
          const disabled = loading || saving !== null || (!master && !local.enabled);
          return (
            <div key={key} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{meta.label}</span>
                  {master ? (
                    <Badge variant={local.enabled ? "destructive" : "secondary"}>
                      {local.enabled ? "ON" : "OFF"}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
              </div>
              <Switch
                checked={local[key]}
                disabled={disabled}
                onCheckedChange={(v) => void update(key, v)}
                aria-label={meta.label}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
