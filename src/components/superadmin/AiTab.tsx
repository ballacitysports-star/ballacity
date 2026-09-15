import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  aiAdminOverview,
  aiAdminRecentFailures,
  aiAdminEffectiveConfig,
  aiAdminSetKillSwitch,
  aiAdminSetFeatureFlag,
} from "@/lib/ai-admin.functions";
import { AI_FEATURES, type AiFeature } from "@/lib/ai/config";
import { describeFeatureDrift } from "@/lib/ai-features-drift";
import { money, duration } from "@/lib/ai-admin-format";
import { AGE_COHORTS, COHORT_META, type AgeCohort } from "@/lib/child-policy";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "./ConfirmAction";

/**
 * AI control centre.
 *
 * Two jobs. It reads the telemetry the AI layer has been recording since it
 * shipped and nothing has ever displayed, and it drives the feature flags
 * through validated writes instead of raw JSON.
 *
 * The second job matters more than it looks. `ai_features` is editable today in
 * Ops & config as free-form JSON, and `parseAiFeatures` silently falls back to
 * the built-in default on anything it does not recognise — so a kill switch
 * written as the string "true", or under a misspelled key, reads back as *off*
 * with no error anywhere. The "edits that did not take" card below is the whole
 * reason this tab exists: it compares the stored row against the config the gate
 * actually uses and names every field that failed to land.
 */

const FEATURE_LABELS: Record<AiFeature, string> = {
  reel_pipeline: "Reel pipeline",
  reel_coach: "Reel coach",
  reel_package: "Reel packaging",
  reel_style: "Reel style",
  text_moderation: "Text moderation",
  image_moderation: "Image moderation",
  background_remove: "Background removal",
  game_assist: "Game drafting help",
  image_generate: "Image generation",
  image_enhance: "Image enhancement",
};

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function Counts({ rows }: { rows: Record<string, number> }) {
  const entries = Object.entries(rows).filter(([, v]) => v > 0);
  if (entries.length === 0)
    return <div className="text-xs text-muted-foreground">Nothing yet.</div>;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="secondary" className="font-mono text-[11px]">
          {k}: {v}
        </Badge>
      ))}
    </div>
  );
}

export function AiTab() {
  const qc = useQueryClient();
  const loadOverview = useServerFn(aiAdminOverview);
  const loadFailures = useServerFn(aiAdminRecentFailures);
  const loadConfig = useServerFn(aiAdminEffectiveConfig);
  const setKill = useServerFn(aiAdminSetKillSwitch);
  const setFlag = useServerFn(aiAdminSetFeatureFlag);

  const overview = useQuery({
    queryKey: ["ai-admin-overview"],
    queryFn: () => loadOverview({}),
    refetchInterval: 60_000,
  });
  const failures = useQuery({
    queryKey: ["ai-admin-failures"],
    queryFn: () => loadFailures({}),
    refetchInterval: 60_000,
  });
  const config = useQuery({ queryKey: ["ai-admin-config"], queryFn: () => loadConfig({}) });

  const [confirmRestart, setConfirmRestart] = useState(false);

  /**
   * Every write returns the re-parsed config, so success is decided by what the
   * gate will actually read — not by the absence of a database error.
   */
  const applied = (next: { killSwitch: boolean }, wanted: boolean) => {
    if (next.killSwitch !== wanted) {
      toast.error("The write did not take effect. The stored value parsed back to its default.");
      return false;
    }
    return true;
  };

  const kill = useMutation({
    mutationFn: (v: { enabled: boolean; reason: string }) => setKill({ data: v }),
    onSuccess: (r: any, v) => {
      if (applied(r.config.features, v.enabled)) {
        toast.success(v.enabled ? "AI stopped across the platform" : "AI features re-enabled");
      }
      setConfirmRestart(false);
      qc.invalidateQueries({ queryKey: ["ai-admin-config"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const flag = useMutation({
    mutationFn: (v: { feature: AiFeature; enabled?: boolean; cohorts?: AgeCohort[] }) =>
      setFlag({ data: v }),
    onSuccess: (r: any, v) => {
      // Compare the actual set, not its size: a write that swapped one cohort
      // for another is exactly the kind of change that must not report success
      // on a count alone.
      const now = r.flag as { enabled: boolean; cohorts: AgeCohort[] };
      const sameCohorts =
        v.cohorts === undefined || [...now.cohorts].sort().join() === [...v.cohorts].sort().join();
      const ok = (v.enabled === undefined || now.enabled === v.enabled) && sameCohorts;
      toast[ok ? "success" : "error"](
        ok ? "Saved" : "The write did not take effect — the stored value parsed back to a default.",
      );
      qc.invalidateQueries({ queryKey: ["ai-admin-config"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const rawFeatures = useMemo(
    () => (config.data?.raw ?? []).find((r: any) => r.key === "ai_features")?.value,
    [config.data],
  );
  const drift = useMemo(() => describeFeatureDrift(rawFeatures), [rawFeatures]);

  if (overview.isLoading || config.isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  const o = overview.data;
  const features = config.data?.config.features;
  const killSwitch = !!features?.killSwitch;
  const errors = o
    ? Object.entries(o.byOutcome).reduce((a, [k, v]) => (k === "ok" ? a : a + v), 0)
    : 0;
  const errorRate = o && o.requests.window > 0 ? (errors / o.requests.window) * 100 : 0;

  return (
    <div className="space-y-4">
      <Card className={killSwitch ? "border-destructive" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Emergency stop</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={killSwitch ? "outline" : "destructive"}
              disabled={kill.isPending}
              onClick={() => {
                if (killSwitch) setConfirmRestart(true);
                else kill.mutate({ enabled: true, reason: "Emergency stop from control centre" });
              }}
            >
              {killSwitch ? "Re-enable AI features" : "Stop all AI now"}
            </Button>
            <Badge variant={killSwitch ? "destructive" : "secondary"}>
              {killSwitch ? "AI is stopped" : "AI is running"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Stopping takes effect immediately and needs no confirmation — an incident is the wrong
            moment for a dialog. Turning AI back on is the deliberate direction and asks for a
            reason. Moderation runs through the same gate, so a stop also pauses automated content
            scanning.
          </p>
        </CardContent>
      </Card>

      {drift.length > 0 ? (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">Edits that did not take</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              The stored <span className="font-mono">ai_features</span> row contains values the
              config parser could not use. Each one was silently replaced by its built-in default,
              so the setting below is not what the row says. Fix them here, or correct the JSON in
              Ops &amp; config.
            </p>
            <ul className="space-y-1 text-xs">
              {drift.map((d) => (
                <li key={d} className="font-mono text-destructive">
                  {d}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Requests today"
          value={o?.requests.today ?? 0}
          hint={`${o?.requests.window ?? 0} in ${o?.windowDays ?? 30}d`}
        />
        <Stat
          label="Spend today"
          value={money(o?.costCents.today ?? 0)}
          hint={`${money(o?.costCents.window ?? 0)} in ${o?.windowDays ?? 30}d`}
        />
        <Stat label="Error rate" value={`${errorRate.toFixed(1)}%`} hint={`${errors} not ok`} />
        <Stat
          label="Queued + running"
          value={(o?.jobs.byStatus["queued"] ?? 0) + (o?.jobs.byStatus["running"] ?? 0)}
          hint={o?.jobs.stuck ? `${o.jobs.stuck} stuck` : "none stuck"}
        />
        <Stat label="Latency p50" value={duration(o?.jobs.latencyMsP50)} />
        <Stat label="Latency p95" value={duration(o?.jobs.latencyMsP95)} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {AI_FEATURES.map((f) => (
            <FeatureRow
              key={f}
              feature={f}
              flag={features?.features[f] ?? { enabled: false, cohorts: [] }}
              usage={o?.byFeature[f] ?? { requests: 0, costCents: 0, errors: 0 }}
              killSwitch={killSwitch}
              pending={flag.isPending}
              onSave={(v) => flag.mutate({ feature: f, ...v })}
            />
          ))}
          <p className="text-[11px] text-muted-foreground">
            A cohort that is not listed is denied. Removing a cohort restricts a feature; adding one
            grants it, and the cohort still has to clear consent, guardian approval and the child
            policy matrix before any AI call runs.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Outcomes ({o?.windowDays ?? 30}d)</CardTitle>
          </CardHeader>
          <CardContent>
            <Counts rows={o?.byOutcome ?? {}} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Jobs by status</CardTitle>
          </CardHeader>
          <CardContent>
            <Counts rows={o?.jobs.byStatus ?? {}} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Moderation verdicts</CardTitle>
          </CardHeader>
          <CardContent>
            <Counts rows={o?.moderation ?? {}} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent failures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            {(failures.data?.failures ?? []).length === 0 ? (
              <div className="text-muted-foreground">No failed jobs.</div>
            ) : (
              (failures.data?.failures ?? []).map((j: any) => (
                <div key={j.id} className="space-y-0.5 border-b pb-1.5 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono">
                      {j.feature} · {j.error_code ?? "no code"}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(j.created_at).toLocaleString()}
                    </span>
                  </div>
                  {j.user_message ? (
                    <div className="text-muted-foreground">{j.user_message}</div>
                  ) : null}
                  <div className="text-[11px] text-muted-foreground">
                    {j.attempts} attempt{j.attempts === 1 ? "" : "s"}
                    {j.model ? ` · ${j.model}` : ""}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Not covered here</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Provider health.</span> Nothing probes the
            gateway independently of a real request, so there is no reading to show. The error rate
            and failure list above are the closest honest signal.
          </p>
          <p>
            <span className="font-medium text-foreground">Abuse detection.</span> Per-user request
            counts exist, but a count is not abuse, and a panel implying otherwise would be worse
            than no panel.
          </p>
        </CardContent>
      </Card>

      <ConfirmAction
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Re-enable AI features"
        description="Every feature that is individually enabled starts running again immediately."
        confirmWord="RESUME"
        pending={kill.isPending}
        onConfirm={(reason) => kill.mutate({ enabled: false, reason })}
      />
    </div>
  );
}

function FeatureRow({
  feature,
  flag,
  usage,
  killSwitch,
  pending,
  onSave,
}: {
  feature: AiFeature;
  flag: { enabled: boolean; cohorts: AgeCohort[] };
  usage: { requests: number; costCents: number; errors: number };
  killSwitch: boolean;
  pending?: boolean;
  onSave: (v: { enabled?: boolean; cohorts?: AgeCohort[] }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AgeCohort[]>(flag.cohorts);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{FEATURE_LABELS[feature]}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{feature}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {usage.requests} calls · {money(usage.costCents)}
            {usage.errors > 0 ? ` · ${usage.errors} failed` : ""}
          </span>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={flag.enabled}
              disabled={pending}
              onCheckedChange={(v) => onSave({ enabled: v })}
            />
            {flag.enabled ? "On" : "Off"}
          </label>
        </div>
      </div>

      {killSwitch && flag.enabled ? (
        <div className="text-[11px] text-destructive">
          Held by the emergency stop — this will not run until AI is re-enabled.
        </div>
      ) : null}

      {editing ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {AGE_COHORTS.map((c) => {
              const on = draft.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft(on ? draft.filter((x) => x !== c) : [...draft, c])}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    on ? "border-foreground bg-foreground text-background" : "text-muted-foreground"
                  }`}
                >
                  {COHORT_META[c].short}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                onSave({ cohorts: draft });
                setEditing(false);
              }}
            >
              Save cohorts
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(flag.cohorts);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {flag.cohorts.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              No cohorts — nobody can use this.
            </span>
          ) : (
            flag.cohorts.map((c) => (
              <Badge key={c} variant="secondary" className="text-[11px]">
                {COHORT_META[c].short}
              </Badge>
            ))
          )}
          <button
            type="button"
            onClick={() => {
              setDraft(flag.cohorts);
              setEditing(true);
            }}
            className="text-[11px] font-medium underline text-muted-foreground hover:text-foreground"
          >
            Edit cohorts
          </button>
        </div>
      )}
    </div>
  );
}
