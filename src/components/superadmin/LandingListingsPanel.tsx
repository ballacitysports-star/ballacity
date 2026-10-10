import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_LANDING_LISTINGS,
  LANDING_LISTINGS_SETTING_KEY,
  parseLandingListings,
  type LandingListingsConfig,
} from "@/lib/landing-listings";

const GRANULAR: {
  key: Exclude<keyof LandingListingsConfig, "showLiveListings">;
  label: string;
  hint: string;
}[] = [
  { key: "showPickupGames", label: "🏀 Pickup games", hint: "“Trending near you”" },
  { key: "showTryouts", label: "📋 Tryouts & camps", hint: "“Upcoming Tryouts & Clinics”" },
  { key: "showAvailability", label: "🙋 Player availability", hint: "“List your availability”" },
  {
    key: "showTrainerSpotlight",
    label: "🏋️ Trainer & facility spotlight",
    hint: "Featured partner trainer",
  },
];

/**
 * Controls which live user listings the public landing page shows. Each toggle
 * saves immediately (optimistic, reverted on failure) to the public
 * `app_settings.landing_listings` row.
 */
export function LandingListingsPanel() {
  const qc = useQueryClient();
  const loadSettings = useServerFn(superadminListSettings);
  const setSetting = useServerFn(superadminSetSetting);

  const settings = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => loadSettings({}),
  });
  const row = (settings.data?.settings ?? []).find(
    (s: { key: string }) => s.key === LANDING_LISTINGS_SETTING_KEY,
  ) as { value: unknown } | undefined;

  const [local, setLocal] = useState<LandingListingsConfig>(DEFAULT_LANDING_LISTINGS);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setLocal(parseLandingListings(row?.value));
  }, [row?.value]);

  async function update(patch: Partial<LandingListingsConfig>, label: string) {
    const prev = local;
    const next = { ...local, ...patch };
    setLocal(next);
    setSaving(true);
    try {
      await setSetting({
        data: {
          key: LANDING_LISTINGS_SETTING_KEY,
          value: next,
          description:
            "Landing page: show/hide live user listings (pickup games, tryouts, availability, trainer spotlight). Missing means show.",
          isPublic: true,
        },
      });
      toast.success(`${label} saved`);
      void qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      void qc.invalidateQueries({ queryKey: ["landing-listings-config"] });
      void qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    } catch (e) {
      setLocal(prev);
      toast.error(e instanceof Error ? e.message : "Could not save setting");
    } finally {
      setSaving(false);
    }
  }

  const disabled = saving || settings.isLoading;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Landing page content & listings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Hide live user content on the public landing page — handy in new markets with few
          listings. Hidden sections also disappear from the top nav and hero links.
        </p>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Show live user listings</span>
            <span className="block text-[11px] text-muted-foreground">
              Master switch. Off hides everything below.
            </span>
          </span>
          <Switch
            checked={local.showLiveListings}
            disabled={disabled}
            onCheckedChange={(v) => update({ showLiveListings: v }, "Live listings")}
          />
        </label>
        <div className="space-y-2">
          {GRANULAR.map((g) => (
            <label
              key={g.key}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <span className="min-w-0">
                <span className="block text-sm">{g.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {g.hint}
                  {!local.showLiveListings ? " · hidden by master switch" : ""}
                </span>
              </span>
              <Switch
                checked={local[g.key]}
                disabled={disabled}
                onCheckedChange={(v) => update({ [g.key]: v }, g.label.replace(/^\S+\s/, ""))}
              />
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
