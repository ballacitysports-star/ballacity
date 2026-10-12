/**
 * Master switches for the family clip and analytics sharing features.
 * Each is read from and written to app_settings as {"enabled": boolean}, and the
 * database enforces them, so flipping one off stops the feature at once. Every change
 * is recorded in the audit log by superadminSetSetting.
 *
 * These are only the master switches. Nothing is shared for a child or an athlete
 * until a parent or the athlete turns on the matching control themselves.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";

type Feature = { key: string; label: string; description: string; needs?: string };

const FEATURES: Feature[] = [
  {
    key: "family_posts",
    label: "Family posts",
    description:
      "A verified guardian can add a private clip of their under-13 child. Never public. Also required by the two switches below.",
  },
  {
    key: "family_post_links",
    label: "Private share links",
    description: "A guardian can send a protected, expiring link to one family clip.",
    needs: "family_posts",
  },
  {
    key: "family_post_team_share",
    label: "Share family clips with a team",
    description: "A guardian can let one team their child is on watch a family clip.",
    needs: "family_posts",
  },
  {
    key: "coach_analytics",
    label: "Analytics sharing with coaches",
    description:
      "Athletes (or a guardian for ages 13 to 15) can share Pro Analytics with a team's coaching staff. Never for under 13.",
  },
];

function isOn(settings: { key: string; value: unknown }[], key: string): boolean {
  const v = settings.find((s) => s.key === key)?.value as { enabled?: unknown } | undefined;
  return v?.enabled === true;
}

export function SharingFeaturesPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(superadminListSettings);
  const setFn = useServerFn(superadminSetSetting);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => listFn(),
  });
  const settings = (data?.settings ?? []) as { key: string; value: unknown }[];

  async function toggle(f: Feature, next: boolean) {
    if (
      next &&
      !window.confirm(
        `Turn on "${f.label}" for everyone?\n\nNothing is shared until a parent or athlete turns on the matching control. Counsel sign-off is advised first.`,
      )
    ) {
      return;
    }
    setBusy(f.key);
    try {
      await setFn({
        data: {
          key: f.key,
          value: { enabled: next },
          isPublic: false,
          reason: `${next ? "Turned on" : "Turned off"} in Super admin`,
        },
      });
      await qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      toast.success(`${f.label} ${next ? "is on" : "is off"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save this setting");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3" aria-label="Sharing features">
      <p className="text-xs text-muted-foreground">
        Master switches. A missing setting counts as off. Turning one off stops the feature
        immediately; the database enforces it. Changes are recorded in the audit log.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {FEATURES.map((f) => {
            const on = isOn(settings, f.key);
            const blocked = !!f.needs && !isOn(settings, f.needs);
            return (
              <li key={f.key} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {f.label}
                    <span className={`ml-2 text-[10px] font-bold uppercase ${on ? "text-lime" : "text-muted-foreground"}`}>
                      {on ? "On" : "Off"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p>
                  {on && blocked && (
                    <p className="mt-1 text-[11px] font-semibold text-amber-300">
                      Has no effect while &ldquo;Family posts&rdquo; is off.
                    </p>
                  )}
                </div>
                <Switch
                  checked={on}
                  disabled={busy === f.key}
                  onCheckedChange={(v) => void toggle(f, v)}
                  aria-label={f.label}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
