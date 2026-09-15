import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";
import {
  AI_FEATURES,
  AI_TIERS,
  DEFAULT_AI_CONFIG,
  parseAiConfig,
  type AiConfig,
  type AiFeature,
  type AiFeaturesConfig,
  type AiLimitsConfig,
  type AiPricingConfig,
  type AiProviderConfig,
  type AiTier,
  type FeatureFlag,
  type TierLimits,
} from "@/lib/ai/config";
import { AGE_COHORTS, COHORT_META, type AgeCohort } from "@/lib/child-policy";
import { ConfirmAction } from "./ConfirmAction";

const AI_SETTING_KEYS = ["ai_features", "ai_limits", "ai_provider", "ai_pricing"] as const;
type AiKey = (typeof AI_SETTING_KEYS)[number];

const FEATURE_META: Record<AiFeature, { label: string; description: string }> = {
  reel_pipeline: {
    label: "Reel pipeline",
    description: "Full AI pass on an uploaded clip: analysis, timeline, edit plan, coaching, copy.",
  },
  reel_coach: {
    label: "Reel Coach chat",
    description: "Conversational agent that can look up and edit a reel when asked.",
  },
  reel_package: {
    label: "Reel post builder",
    description: "One-shot caption, on-screen text and hashtag package for a reel.",
  },
  reel_style: {
    label: "Reel restyle preview",
    description: "Regenerates copy/edit plan/coaching in a new style without touching the published reel.",
  },
  text_moderation: {
    label: "Text moderation",
    description: "Safety check on AI-written text before it's saved. Platform-run and unmetered.",
  },
  image_moderation: {
    label: "Image moderation",
    description: "Safety check on images before they're saved. Platform-run and unmetered.",
  },
  background_remove: {
    label: "Background removal",
    description: "Cuts the subject out of a photo in the image editor.",
  },
  image_generate: {
    label: "Image generation",
    description: "Phase 4 — not yet wired to a frontend entry point. Adult-only when enabled.",
  },
  image_enhance: {
    label: "Image enhancement",
    description: "Phase 4 — not yet wired to a frontend entry point. Adult-only when enabled.",
  },
};

const TIER_LABELS: Record<AiTier, string> = {
  free: "Free",
  premium: "Premium",
  team: "Team",
  gym: "Gym",
};

const TIER_BASIC_META: {
  key: keyof Omit<TierLimits, "perFeature">;
  label: string;
  hint: string;
  min: number;
}[] = [
  {
    key: "maxConcurrentJobs",
    label: "Max concurrent jobs",
    hint: "AI jobs this tier can have in flight at once",
    min: 1,
  },
  {
    key: "maxVideoSeconds",
    label: "Max clip length (sec)",
    hint: "Longest clip the reel pipeline accepts",
    min: 1,
  },
  {
    key: "maxResolution",
    label: "Max resolution (px)",
    hint: "Longest edge, in pixels",
    min: 240,
  },
  {
    key: "maxUploadMb",
    label: "Max upload size (MB)",
    hint: "Largest file accepted",
    min: 1,
  },
  {
    key: "maxProcessingSeconds",
    label: "Max processing time (sec)",
    hint: "Safety timeout per job",
    min: 30,
  },
];

const PROVIDER_META: { key: keyof AiProviderConfig; label: string }[] = [
  { key: "provider", label: "Provider" },
  { key: "textModel", label: "Text model" },
  { key: "visionModel", label: "Vision model" },
  { key: "audioModel", label: "Audio / transcription model" },
  { key: "moderationTextModel", label: "Text moderation model" },
  { key: "moderationImageModel", label: "Image moderation model" },
  { key: "imageModel", label: "Image generation / edit model" },
];

function NumberField({
  value,
  onChange,
  onCommit,
  min = 0,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      min={min}
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      onBlur={onCommit}
      className="w-full rounded-md border bg-background px-2 py-1 text-xs tabular-nums disabled:opacity-50"
    />
  );
}

/**
 * Superadmin control panel for the shared AI service layer (`src/lib/ai/config.ts`):
 * feature flags + cohort allowances, per-tier quota limits, provider/model
 * selection, and cost-estimate pricing. These map 1:1 onto the `ai_features`,
 * `ai_limits`, `ai_provider` and `ai_pricing` rows in `app_settings` that
 * `assertAiAllowed` reads on every AI call — changes here take effect for new
 * calls within ~30s (the server-side config cache window), no deploy needed.
 *
 * Safety scanning (text/image moderation) ignores the kill switch and quotas
 * by design — it runs on the platform's behalf, not the member's plan.
 */
export function AiTab() {
  const qc = useQueryClient();
  const loadSettings = useServerFn(superadminListSettings);
  const setSetting = useServerFn(superadminSetSetting);

  const query = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async (): Promise<AiConfig> => {
      const { settings } = await loadSettings({});
      const rows: Record<string, unknown> = {};
      for (const s of settings as { key: string; value: unknown }[]) {
        if ((AI_SETTING_KEYS as readonly string[]).includes(s.key)) rows[s.key] = s.value;
      }
      return parseAiConfig(rows);
    },
    staleTime: 30_000,
  });

  const [features, setFeatures] = useState<AiFeaturesConfig>(DEFAULT_AI_CONFIG.features);
  const [limits, setLimits] = useState<AiLimitsConfig>(DEFAULT_AI_CONFIG.limits);
  const [provider, setProvider] = useState<AiProviderConfig>(DEFAULT_AI_CONFIG.provider);
  const [pricing, setPricing] = useState<AiPricingConfig>(DEFAULT_AI_CONFIG.pricing);
  const [pending, setPending] = useState<AiKey | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [activeTier, setActiveTier] = useState<AiTier>("free");

  useEffect(() => {
    if (!query.data) return;
    setFeatures(query.data.features);
    setLimits(query.data.limits);
    setProvider(query.data.provider);
    setPricing(query.data.pricing);
    // Only re-sync when a fetch actually completes, so mid-edit state never gets clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.dataUpdatedAt]);

  const loading = query.isLoading;
  const disabled = loading || pending !== null;

  async function persist(key: AiKey, value: unknown, label: string) {
    setPending(key);
    try {
      await setSetting({ data: { key, value } });
      toast.success(`${label} saved`);
      qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save setting");
      void query.refetch();
    } finally {
      setPending(null);
    }
  }

  function setKillSwitch(v: boolean) {
    const next: AiFeaturesConfig = { ...features, killSwitch: v };
    setFeatures(next);
    void persist("ai_features", next, v ? "Kill switch turned on" : "Kill switch turned off");
  }

  function updateFeature(feature: AiFeature, patch: Partial<FeatureFlag>) {
    const next: AiFeaturesConfig = {
      ...features,
      features: {
        ...features.features,
        [feature]: { ...features.features[feature], ...patch },
      },
    };
    setFeatures(next);
    void persist("ai_features", next, FEATURE_META[feature].label);
  }

  function toggleCohort(feature: AiFeature, cohort: AgeCohort) {
    const current = features.features[feature].cohorts;
    const nextCohorts = current.includes(cohort)
      ? current.filter((c) => c !== cohort)
      : [...current, cohort];
    updateFeature(feature, { cohorts: nextCohorts });
  }

  function updateTierBasic(tier: AiTier, key: keyof Omit<TierLimits, "perFeature">, value: number) {
    setLimits({ ...limits, [tier]: { ...limits[tier], [key]: value } });
  }

  function updateTierFeatureLimit(
    tier: AiTier,
    feature: AiFeature,
    field: "daily" | "monthly",
    value: number,
  ) {
    setLimits({
      ...limits,
      [tier]: {
        ...limits[tier],
        perFeature: {
          ...limits[tier].perFeature,
          [feature]: { ...limits[tier].perFeature[feature], [field]: value },
        },
      },
    });
  }

  function commitLimits(label: string) {
    void persist("ai_limits", limits, label);
  }

  function updateProviderField(key: keyof AiProviderConfig, value: string) {
    setProvider({ ...provider, [key]: value });
  }

  function commitProvider() {
    void persist("ai_provider", provider, "Provider & models");
  }

  function updatePricingField(
    model: string,
    field: "inputCentsPerMTok" | "outputCentsPerMTok",
    value: number,
  ) {
    setPricing({
      ...pricing,
      models: { ...pricing.models, [model]: { ...pricing.models[model], [field]: value } },
    });
  }

  function commitPricing(label: string) {
    void persist("ai_pricing", pricing, label);
  }

  function addPricingRow(model: string) {
    const id = model.trim();
    if (!id || pricing.models[id]) return;
    const next: AiPricingConfig = {
      models: { ...pricing.models, [id]: { inputCentsPerMTok: 0, outputCentsPerMTok: 0 } },
    };
    setPricing(next);
    setNewModelId("");
    void persist("ai_pricing", next, `Pricing for ${id}`);
  }

  function removePricingRow(model: string) {
    const models = { ...pricing.models };
    delete models[model];
    const next: AiPricingConfig = { models };
    setPricing(next);
    void persist("ai_pricing", next, `Removed pricing for ${model}`);
  }

  async function restoreDefaults() {
    setPending("ai_features");
    try {
      await Promise.all([
        setSetting({ data: { key: "ai_features", value: DEFAULT_AI_CONFIG.features } }),
        setSetting({ data: { key: "ai_limits", value: DEFAULT_AI_CONFIG.limits } }),
        setSetting({ data: { key: "ai_provider", value: DEFAULT_AI_CONFIG.provider } }),
        setSetting({ data: { key: "ai_pricing", value: DEFAULT_AI_CONFIG.pricing } }),
      ]);
      toast.success("Restored recommended AI defaults");
      await query.refetch();
      qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore defaults");
    } finally {
      setPending(null);
      setConfirmReset(false);
    }
  }

  const referencedModels = new Set(
    PROVIDER_META.filter((m) => m.key !== "provider").map((m) => provider[m.key]).filter(Boolean),
  );
  const unpricedModels = [...referencedModels].filter((m) => !pricing.models[m]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold">Shared AI service layer</span>
        </div>
        <p className="text-xs text-muted-foreground">
          These rows live in <span className="font-mono">app_settings</span> (
          <span className="font-mono">ai_features</span>, <span className="font-mono">ai_limits</span>,{" "}
          <span className="font-mono">ai_provider</span>, <span className="font-mono">ai_pricing</span>) and
          are read on every AI call by <span className="font-mono">assertAiAllowed</span>. Changes apply to
          new calls within about 30 seconds — no deploy needed. Text and image moderation ignore the kill
          switch and quotas by design: they run on the platform's behalf, not the member's plan.
        </p>
      </div>

      <div className="rounded-xl border border-destructive/40 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Kill switch</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turns off every AI feature at once, except moderation. Use this if a provider incident or
              runaway cost needs an immediate, site-wide stop.
            </p>
          </div>
          <Switch
            checked={features.killSwitch}
            disabled={disabled}
            onCheckedChange={setKillSwitch}
            aria-label="AI kill switch"
          />
        </div>
        {features.killSwitch && (
          <p className="mt-2 text-xs font-semibold text-destructive">
            AI is currently OFF platform-wide (moderation still runs).
          </p>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Feature flags &amp; cohort allowances</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A cohort not checked is denied for that feature — minors never gain a feature by omission.
        </p>
        <div className="mt-3 space-y-3">
          {AI_FEATURES.map((feature) => {
            const flag = features.features[feature];
            const meta = FEATURE_META[feature];
            return (
              <div key={feature} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{meta.label}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
                  </div>
                  <Switch
                    checked={flag.enabled}
                    disabled={disabled}
                    onCheckedChange={(v) => updateFeature(feature, { enabled: v })}
                    aria-label={`${meta.label} enabled`}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {AGE_COHORTS.map((cohort) => {
                    const active = flag.cohorts.includes(cohort);
                    return (
                      <button
                        key={cohort}
                        type="button"
                        title={COHORT_META[cohort].label}
                        disabled={disabled}
                        onClick={() => toggleCohort(feature, cohort)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium disabled:opacity-50 ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input text-muted-foreground"
                        }`}
                      >
                        {COHORT_META[cohort].short}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Per-tier quotas</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Concurrency and media ceilings, plus daily/monthly call limits per feature. Saved fields commit
          on blur.
        </p>
        <Tabs value={activeTier} onValueChange={(v) => setActiveTier(v as AiTier)} className="mt-3">
          <TabsList className="flex-wrap h-auto">
            {AI_TIERS.map((tier) => (
              <TabsTrigger key={tier} value={tier}>
                {TIER_LABELS[tier]}
              </TabsTrigger>
            ))}
          </TabsList>
          {AI_TIERS.map((tier) => (
            <TabsContent key={tier} value={tier} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {TIER_BASIC_META.map((m) => (
                  <label key={m.key} className="block">
                    <span className="text-xs font-medium">{m.label}</span>
                    <input
                      type="number"
                      min={m.min}
                      value={limits[tier][m.key]}
                      disabled={disabled}
                      onChange={(e) => updateTierBasic(tier, m.key, Number(e.target.value))}
                      onBlur={() => commitLimits(`${TIER_LABELS[tier]} · ${m.label}`)}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-50"
                    />
                    <span className="text-[11px] text-muted-foreground">{m.hint}</span>
                  </label>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Feature</th>
                      <th className="py-1.5 px-2 font-medium">Daily</th>
                      <th className="py-1.5 px-2 font-medium">Monthly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AI_FEATURES.map((feature) => {
                      const fl = limits[tier].perFeature[feature];
                      return (
                        <tr key={feature} className="border-b last:border-0">
                          <td className="py-1.5 pr-2">{FEATURE_META[feature].label}</td>
                          <td className="py-1.5 px-2">
                            <NumberField
                              value={fl.daily}
                              disabled={disabled}
                              onChange={(v) => updateTierFeatureLimit(tier, feature, "daily", v)}
                              onCommit={() =>
                                commitLimits(`${TIER_LABELS[tier]} · ${FEATURE_META[feature].label}`)
                              }
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <NumberField
                              value={fl.monthly}
                              disabled={disabled}
                              onChange={(v) => updateTierFeatureLimit(tier, feature, "monthly", v)}
                              onCommit={() =>
                                commitLimits(`${TIER_LABELS[tier]} · ${FEATURE_META[feature].label}`)
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Provider &amp; models</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Names only — API keys stay in the server environment and are never part of this config.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {PROVIDER_META.map((m) => (
            <label key={m.key} className="block">
              <span className="text-xs font-medium">{m.label}</span>
              <input
                type="text"
                value={provider[m.key]}
                disabled={disabled}
                onChange={(e) => updateProviderField(m.key, e.target.value)}
                onBlur={commitProvider}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Pricing estimates</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Dollars-per-million-token estimates, in cents, used for cost reporting only — never billed
          from.
        </p>
        {unpricedModels.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Referenced but unpriced:</span>
            {unpricedModels.map((m) => (
              <button
                key={m}
                type="button"
                disabled={disabled}
                onClick={() => addPricingRow(m)}
                className="rounded-full border border-dashed px-2 py-0.5 font-mono disabled:opacity-50"
              >
                + {m}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Model</th>
                <th className="py-1.5 px-2 font-medium">Input ¢/M tok</th>
                <th className="py-1.5 px-2 font-medium">Output ¢/M tok</th>
                <th className="py-1.5 pl-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {Object.entries(pricing.models).map(([model, price]) => (
                <tr key={model} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 font-mono">{model}</td>
                  <td className="py-1.5 px-2">
                    <NumberField
                      value={price.inputCentsPerMTok}
                      disabled={disabled}
                      onChange={(v) => updatePricingField(model, "inputCentsPerMTok", v)}
                      onCommit={() => commitPricing(`Pricing for ${model}`)}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <NumberField
                      value={price.outputCentsPerMTok}
                      disabled={disabled}
                      onChange={(v) => updatePricingField(model, "outputCentsPerMTok", v)}
                      onCommit={() => commitPricing(`Pricing for ${model}`)}
                    />
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removePricingRow(model)}
                      className="text-[11px] font-semibold text-destructive disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            placeholder="provider/model-id"
            className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-1.5 text-xs font-mono"
          />
          <button
            type="button"
            disabled={disabled || !newModelId.trim()}
            onClick={() => addPricingRow(newModelId)}
            className="rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            Add model
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setConfirmReset(true)}
        disabled={disabled}
        className="rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50"
      >
        Restore recommended defaults
      </button>

      <ConfirmAction
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Restore recommended AI defaults"
        description="Overwrites feature flags, quotas, provider/model names and pricing with the built-in defaults from src/lib/ai/config.ts. This cannot be undone from here."
        confirmWord="RESET"
        requireReason={false}
        pending={pending !== null}
        onConfirm={() => void restoreDefaults()}
      />
    </div>
  );
}
