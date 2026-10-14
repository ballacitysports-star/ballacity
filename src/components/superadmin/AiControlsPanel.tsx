/**
 * Structured editor for the AI settings rows (`ai_features`, `ai_limits`,
 * `ai_provider`). Replaces hand-editing them as raw JSON on Ops & config.
 *
 * Saves go through superadminSetSetting, which audits the change and drops the
 * server's AI config cache, so a new cap or switch applies on the next request.
 * Each section saves the whole parsed row, so a partial or malformed row in the
 * database is normalised to a complete one on first save.
 *
 * Age cohorts are shown, never edited here: widening who a feature reaches is
 * a safety decision, not an ops knob.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Power, ShieldCheck, Sparkles } from "lucide-react";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";
import {
  AI_FEATURES,
  AI_TIERS,
  parseAiConfig,
  type AiFeature,
  type AiFeaturesConfig,
  type AiLimitsConfig,
  type AiProviderConfig,
  type AiTier,
} from "@/lib/ai/config";
import {
  AI_FEATURE_META,
  AI_TIER_LABELS,
  PLATFORM_AI_FEATURES,
  TIER_LIMIT_FIELDS,
  applyRecommendedPreset,
  limitsProblems,
} from "@/lib/ai/admin-controls";
import { STORAGE_MAX_UPLOAD_MB } from "@/lib/ai/upload-limits";
import { COHORT_META } from "@/lib/child-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmAction } from "./ConfirmAction";

const PROVIDER_FIELDS: { key: keyof AiProviderConfig; label: string }[] = [
  { key: "provider", label: "Provider" },
  { key: "textModel", label: "Text" },
  { key: "visionModel", label: "Vision" },
  { key: "analyticsModel", label: "Pro Analytics (pose / biomechanics)" },
  { key: "audioModel", label: "Audio" },
  { key: "moderationTextModel", label: "Safety: text moderation" },
  { key: "moderationImageModel", label: "Safety: image moderation" },
  { key: "imageModel", label: "Image" },
];

const METERED_FEATURES = AI_FEATURES.filter((f) => !PLATFORM_AI_FEATURES.includes(f));

export function AiControlsPanel() {
  const listFn = useServerFn(superadminListSettings);
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => listFn(),
  });

  const config = useMemo(() => {
    const byKey: Record<string, unknown> = {};
    for (const r of (data?.settings ?? []) as { key: string; value: unknown }[]) {
      byKey[r.key] = r.value;
    }
    return parseAiConfig(byKey);
  }, [data]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  // Each editor is keyed on its saved value so its draft re-seeds after a save
  // or a change made elsewhere, instead of a stale draft overwriting it.
  return (
    <div className="space-y-3">
      <KillSwitchCard features={config.features} />
      <div className="grid gap-3 lg:grid-cols-2">
        <FeaturesCard key={JSON.stringify(config.features)} features={config.features} />
        <ProviderCard key={JSON.stringify(config.provider)} provider={config.provider} />
      </div>
      <LimitsCard key={JSON.stringify(config.limits)} limits={config.limits} />
    </div>
  );
}

function useSaveSetting() {
  const qc = useQueryClient();
  const setFn = useServerFn(superadminSetSetting);
  return useMutation({
    mutationFn: (v: { key: string; value: unknown; reason: string }) =>
      setFn({ data: { key: v.key, value: v.value, isPublic: false, reason: v.reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
}

/* ------------------------------ kill switch ------------------------------ */

function KillSwitchCard({ features }: { features: AiFeaturesConfig }) {
  const save = useSaveSetting();
  const [confirm, setConfirm] = useState(false);
  const halted = features.killSwitch;

  return (
    <Card className={halted ? "border-destructive" : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Power className={`h-4 w-4 ${halted ? "text-destructive" : "text-muted-foreground"}`} />
            AI kill switch
            <Badge variant={halted ? "destructive" : "secondary"}>
              {halted ? "All AI halted" : "AI running"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Stops every member-facing AI feature on the next request. Safety moderation keeps
            running either way.
          </p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Text and image moderation are{" "}
            {features.features.text_moderation.enabled && features.features.image_moderation.enabled
              ? "on and unmetered"
              : "NOT fully on — check the ai_features row"}
            .
          </p>
        </div>
        <Button
          variant={halted ? "default" : "destructive"}
          onClick={() => setConfirm(true)}
          disabled={save.isPending}
        >
          {halted ? "Resume AI" : "Halt all AI"}
        </Button>
      </CardContent>
      <ConfirmAction
        open={confirm}
        onOpenChange={setConfirm}
        title={halted ? "Resume AI features" : "Halt all AI features"}
        description={
          halted
            ? "Member-facing AI features turn back on, subject to their own switches."
            : "Every member-facing AI feature stops on its next request. In-flight jobs finish."
        }
        confirmWord={halted ? "RESUME" : "HALT"}
        pending={save.isPending}
        onConfirm={(reason) =>
          save.mutate(
            { key: "ai_features", value: { ...features, killSwitch: !halted }, reason },
            {
              onSuccess: () => {
                setConfirm(false);
                toast.success(halted ? "AI resumed" : "All AI halted");
              },
            },
          )
        }
      />
    </Card>
  );
}

/* ---------------------------- feature toggles ---------------------------- */

function FeaturesCard({ features }: { features: AiFeaturesConfig }) {
  const save = useSaveSetting();

  function toggle(feature: AiFeature, enabled: boolean) {
    save.mutate(
      {
        key: "ai_features",
        value: {
          ...features,
          features: { ...features.features, [feature]: { ...features.features[feature], enabled } },
        },
        reason: `${AI_FEATURE_META[feature].label} ${enabled ? "enabled" : "disabled"} in AI controls`,
      },
      {
        onSuccess: () =>
          toast.success(`${AI_FEATURE_META[feature].label} ${enabled ? "on" : "off"}`),
      },
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Features &amp; age cohorts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          A cohort not listed is denied. Cohorts are read-only here.
        </p>
        {AI_FEATURES.map((f) => {
          const flag = features.features[f];
          const platform = PLATFORM_AI_FEATURES.includes(f);
          return (
            <div key={f} className="flex items-start justify-between gap-3 rounded-lg border p-2.5">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {AI_FEATURE_META[f].label}{" "}
                  <span className="font-mono text-[10px] text-muted-foreground">{f}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {AI_FEATURE_META[f].description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {platform ? (
                    <Badge variant="secondary">Platform safety · all accounts</Badge>
                  ) : flag.cohorts.length === 0 ? (
                    <Badge variant="destructive">No cohort allowed</Badge>
                  ) : (
                    flag.cohorts.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px]">
                        {COHORT_META[c].short}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              {platform ? (
                <Badge variant="secondary" className="shrink-0">
                  Always on
                </Badge>
              ) : (
                <Switch
                  checked={flag.enabled}
                  disabled={save.isPending}
                  onCheckedChange={(v) => toggle(f, v)}
                  aria-label={AI_FEATURE_META[f].label}
                />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- providers ------------------------------- */

function ProviderCard({ provider }: { provider: AiProviderConfig }) {
  const save = useSaveSetting();
  const [draft, setDraft] = useState(provider);
  const dirty = JSON.stringify(draft) !== JSON.stringify(provider);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Provider &amp; models</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Model names only. API keys live in the server environment and never here. A blank field
          falls back to the built-in default.
        </p>
        {PROVIDER_FIELDS.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-xs font-medium">{f.label}</span>
            <Input
              value={draft[f.key]}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              className="font-mono text-xs"
            />
          </label>
        ))}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                { key: "ai_provider", value: draft, reason: "Models updated in AI controls" },
                { onSuccess: () => toast.success("Models saved") },
              )
            }
          >
            Save models
          </Button>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(provider)}>
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------- limits -------------------------------- */

function LimitsCard({ limits }: { limits: AiLimitsConfig }) {
  const save = useSaveSetting();
  const [draft, setDraft] = useState(limits);
  const [tier, setTier] = useState<AiTier>("free");
  const dirty = JSON.stringify(draft) !== JSON.stringify(limits);
  const problems = limitsProblems(draft);

  const setTierField = (t: AiTier, key: string, v: number) =>
    setDraft({ ...draft, [t]: { ...draft[t], [key]: v } });
  const setQuota = (t: AiTier, f: AiFeature, which: "daily" | "monthly", v: number) =>
    setDraft({
      ...draft,
      [t]: {
        ...draft[t],
        perFeature: { ...draft[t].perFeature, [f]: { ...draft[t].perFeature[f], [which]: v } },
      },
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">Tier limits</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(applyRecommendedPreset(draft));
            toast.message("Recommended preset loaded — review, then save");
          }}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          Load recommended preset
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The tier comes from the member's plan (or the Free Mode tier on Monetization). Daily and
          monthly caps are a cost ceiling per member. Safety moderation is never metered.
        </p>
        <p className="text-xs text-muted-foreground">
          Clip length and upload size are checked when a reel is uploaded. Storage refuses files
          over {STORAGE_MAX_UPLOAD_MB} MB, so a higher upload size acts as {STORAGE_MAX_UPLOAD_MB}{" "}
          MB.
        </p>

        <Tabs value={tier} onValueChange={(v) => setTier(v as AiTier)}>
          <TabsList className="h-auto flex-wrap">
            {AI_TIERS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {AI_TIER_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          {AI_TIERS.map((t) => (
            <TabsContent key={t} value={t} className="space-y-4 pt-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {TIER_LIMIT_FIELDS.map((f) => (
                  <label key={f.key} className="block space-y-1">
                    <span className="flex items-center gap-1 text-xs font-medium">
                      {f.label}
                      {!f.enforced && (
                        <Badge variant="outline" className="px-1 text-[9px]">
                          not enforced yet
                        </Badge>
                      )}
                    </span>
                    <NumberInput
                      value={draft[t][f.key]}
                      min={f.min}
                      suffix={f.unit}
                      onChange={(v) => setTierField(t, f.key, v)}
                    />
                  </label>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 font-medium">Feature</th>
                      <th className="py-1 font-medium">Per day</th>
                      <th className="py-1 font-medium">Per month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METERED_FEATURES.map((f) => (
                      <tr key={f} className="border-t">
                        <td className="py-1.5 pr-2">{AI_FEATURE_META[f].label}</td>
                        <td className="py-1.5 pr-2">
                          <NumberInput
                            value={draft[t].perFeature[f].daily}
                            min={0}
                            onChange={(v) => setQuota(t, f, "daily", v)}
                          />
                        </td>
                        <td className="py-1.5">
                          <NumberInput
                            value={draft[t].perFeature[f].monthly}
                            min={0}
                            onChange={(v) => setQuota(t, f, "monthly", v)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {problems.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-destructive">
            {problems.slice(0, 6).map((p) => (
              <li key={p}>{p}</li>
            ))}
            {problems.length > 6 && <li>…and {problems.length - 6} more.</li>}
          </ul>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!dirty || problems.length > 0 || save.isPending}
            onClick={() =>
              save.mutate(
                { key: "ai_limits", value: draft, reason: "Tier limits updated in AI controls" },
                { onSuccess: () => toast.success("Limits saved — live on the next request") },
              )
            }
          >
            Save all tiers
          </Button>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(limits)}>
            Discard
          </Button>
          {dirty && <span className="self-center text-[11px] text-amber-500">Unsaved changes</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function NumberInput({
  value,
  min,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Math.round(Number(e.target.value)))}
        className="h-8 text-xs"
      />
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}
