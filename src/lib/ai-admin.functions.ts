import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_FEATURES, isAiFeature, type AiFeature, type AiFeaturesConfig } from "@/lib/ai/config";
import { AGE_COHORTS, type AgeCohort } from "@/lib/child-policy";

/**
 * Superadmin read and control surface for the AI layer.
 *
 * The layer has recorded jobs, usage, cost and moderation verdicts since it
 * shipped; nothing in the app read any of it. These are the queries behind
 * AiTab.
 *
 * The writes exist for a sharper reason. `ai_features` is already editable as
 * raw JSON in OpsTab, and `parseAiFeatures` is deliberately forgiving — junk
 * falls back to the built-in default rather than breaking a feature. That
 * protects availability and it makes the emergency stop fail open: writing
 * `"killSwitch": "true"` as a string, or misspelling the key, parses back to
 * `false` with no error anywhere. An admin reaching for the kill switch during
 * an incident is the last person who can afford a silent no-op.
 *
 * So these functions validate before writing, and every one of them returns the
 * re-parsed effective config. The UI shows what actually took effect rather
 * than echoing what was submitted.
 */

const WINDOW_DAYS = 30;

type UsageRow = {
  feature: string | null;
  outcome: string | null;
  est_cost_cents: number | string | null;
  created_at: string;
};

function cents(v: number | string | null): number {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function loadEffective(admin: any) {
  const { loadAiConfig } = await import("@/lib/ai/settings.server");
  // `fresh` skips the 30s cache: an admin looking at this page needs the row as
  // it stands, not as it was half a minute ago.
  return loadAiConfig(admin, { fresh: true });
}

/** Everything the overview cards need, in one round trip per table. */
export const aiAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertSuperadmin, getAdmin } = await import("@/lib/superadmin.server");
    await assertSuperadmin(context);
    const admin = await getAdmin();

    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const [{ data: usage }, { data: jobs }, { data: verdicts }] = await Promise.all([
      admin
        .from("ai_usage_events")
        .select("feature,outcome,est_cost_cents,created_at")
        .gte("created_at", since),
      admin
        .from("ai_generation_jobs")
        .select("status,feature,started_at,finished_at,heartbeat_at,created_at")
        .gte("created_at", since),
      admin.from("ai_text_moderation").select("verdict,created_at").gte("created_at", since),
    ]);

    const rows = (usage ?? []) as UsageRow[];
    const today = rows.filter((r) => r.created_at >= dayStart.toISOString());

    const byFeature: Record<string, { requests: number; costCents: number; errors: number }> = {};
    for (const f of AI_FEATURES) byFeature[f] = { requests: 0, costCents: 0, errors: 0 };
    const byOutcome: Record<string, number> = {};

    for (const r of rows) {
      const key = r.feature ?? "unknown";
      byFeature[key] ??= { requests: 0, costCents: 0, errors: 0 };
      byFeature[key].requests += 1;
      byFeature[key].costCents += cents(r.est_cost_cents);
      if (r.outcome && r.outcome !== "ok") byFeature[key].errors += 1;
      byOutcome[r.outcome ?? "unknown"] = (byOutcome[r.outcome ?? "unknown"] ?? 0) + 1;
    }

    const jobRows = (jobs ?? []) as {
      status: string | null;
      started_at: string | null;
      finished_at: string | null;
      heartbeat_at: string | null;
    }[];
    const byStatus: Record<string, number> = {};
    const latencies: number[] = [];
    for (const j of jobRows) {
      byStatus[j.status ?? "unknown"] = (byStatus[j.status ?? "unknown"] ?? 0) + 1;
      if (j.started_at && j.finished_at) {
        const ms = Date.parse(j.finished_at) - Date.parse(j.started_at);
        if (Number.isFinite(ms) && ms >= 0) latencies.push(ms);
      }
    }
    latencies.sort((a, b) => a - b);
    const pct = (p: number) =>
      latencies.length
        ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]
        : null;

    // A job still marked running whose heartbeat stopped is the shape a stuck
    // job takes; the pipeline heart-beats while it works.
    const staleBefore = Date.now() - 15 * 60_000;
    const stuck = jobRows.filter(
      (j) =>
        (j.status === "running" || j.status === "queued") &&
        (!j.heartbeat_at || Date.parse(j.heartbeat_at) < staleBefore),
    ).length;

    const verdictCounts: Record<string, number> = {};
    for (const v of (verdicts ?? []) as { verdict: string | null }[]) {
      verdictCounts[v.verdict ?? "unknown"] = (verdictCounts[v.verdict ?? "unknown"] ?? 0) + 1;
    }

    return {
      windowDays: WINDOW_DAYS,
      requests: { today: today.length, window: rows.length },
      costCents: {
        today: today.reduce((a, r) => a + cents(r.est_cost_cents), 0),
        window: rows.reduce((a, r) => a + cents(r.est_cost_cents), 0),
      },
      byFeature,
      byOutcome,
      jobs: { byStatus, stuck, latencyMsP50: pct(0.5), latencyMsP95: pct(0.95) },
      moderation: verdictCounts,
    };
  });

/** Recent failures, user-safe fields only — never a raw provider body. */
export const aiAdminRecentFailures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertSuperadmin, getAdmin } = await import("@/lib/superadmin.server");
    await assertSuperadmin(context);
    const admin = await getAdmin();

    const { data } = await admin
      .from("ai_generation_jobs")
      .select("id,feature,status,error_code,user_message,attempts,model,provider,created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(25);

    return { failures: data ?? [] };
  });

/** The parsed config as the gate sees it, next to the raw stored rows. */
export const aiAdminEffectiveConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertSuperadmin, getAdmin } = await import("@/lib/superadmin.server");
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { AI_SETTING_KEYS } = await import("@/lib/ai/settings.server");

    const [config, { data: raw }] = await Promise.all([
      loadEffective(admin),
      admin
        .from("app_settings")
        .select("key,value,updated_at,updated_by")
        .in("key", AI_SETTING_KEYS as unknown as string[]),
    ]);

    return { config, raw: raw ?? [] };
  });

/**
 * Read-modify-write of the `ai_features` row.
 *
 * Reads the row through the same parser the gate uses, applies one change, and
 * writes the whole validated object back. Merging on the parsed value rather
 * than the raw JSON means a row that was already malformed gets repaired on the
 * next edit instead of carrying its defect forward.
 *
 * Exported for tests: the cache invalidation below is the part that is easy to
 * drop in a refactor and impossible to notice in production.
 */
export async function writeFeatures(
  admin: any,
  actorId: string,
  mutate: (current: AiFeaturesConfig) => AiFeaturesConfig,
  audit: {
    action: string;
    targetId: string;
    reason?: string | null;
    after: Record<string, unknown>;
  },
) {
  const { parseAiFeatures } = await import("@/lib/ai/config");
  const { invalidateAiConfigCache } = await import("@/lib/ai/settings.server");
  const { writeAudit } = await import("@/lib/superadmin.server");

  const { data: row } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "ai_features")
    .maybeSingle();

  const before = parseAiFeatures(row?.value);
  const next = mutate(before);

  const { error } = await admin
    .from("app_settings")
    .upsert(
      { key: "ai_features", value: next as unknown, updated_by: actorId },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);

  // Without this the gate keeps serving the cached config for up to 30s — the
  // wrong behaviour when the change being made is an emergency stop.
  invalidateAiConfigCache();

  await writeAudit(admin, actorId, {
    action: audit.action,
    targetType: "ai_feature_flag",
    targetId: audit.targetId,
    reason: audit.reason ?? null,
    before,
    after: audit.after,
  });

  return loadEffective(admin);
}

/**
 * Validated shapes for the two writes. Separate from the server functions so a
 * test can prove an unknown feature or a misspelled cohort is rejected rather
 * than written and silently discarded by the parser later.
 */
export const killSwitchInput = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const featureFlagInput = z.object({
  feature: z.string().refine(isAiFeature, "Unknown AI feature"),
  enabled: z.boolean().optional(),
  cohorts: z
    .array(
      z.string().refine((c) => (AGE_COHORTS as readonly string[]).includes(c), "Unknown cohort"),
    )
    .optional(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Applies one flag change to the parsed config.
 *
 * Every other feature is carried through untouched: an admin turning off image
 * generation must not quietly reset the cohorts on reel coaching.
 */
export function applyFeatureFlag(
  current: AiFeaturesConfig,
  change: { feature: AiFeature; enabled?: boolean; cohorts?: AgeCohort[] },
): AiFeaturesConfig {
  const existing = current.features[change.feature];
  return {
    ...current,
    features: {
      ...current.features,
      [change.feature]: {
        enabled: change.enabled ?? existing.enabled,
        cohorts: change.cohorts ?? existing.cohorts,
      },
    },
  };
}

export const aiAdminSetKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => killSwitchInput.parse(d))
  .handler(async ({ context, data }) => {
    const { assertSuperadmin, getAdmin } = await import("@/lib/superadmin.server");
    await assertSuperadmin(context);
    const admin = await getAdmin();

    const config = await writeFeatures(
      admin,
      context.userId,
      (current) => ({ ...current, killSwitch: data.enabled }),
      {
        action: data.enabled ? "ai.kill_switch_on" : "ai.kill_switch_off",
        targetId: "killSwitch",
        reason: data.reason ?? null,
        after: { killSwitch: data.enabled },
      },
    );

    // The caller compares this against what it asked for. They can only differ
    // if the value failed to round-trip, which is the failure this whole
    // function exists to make impossible to miss.
    return { config, killSwitch: config.features.killSwitch };
  });

export const aiAdminSetFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => featureFlagInput.parse(d))
  .handler(async ({ context, data }) => {
    const { assertSuperadmin, getAdmin } = await import("@/lib/superadmin.server");
    await assertSuperadmin(context);
    const admin = await getAdmin();

    const feature = data.feature as AiFeature;
    const change = {
      feature,
      enabled: data.enabled,
      cohorts: data.cohorts as AgeCohort[] | undefined,
    };
    const config = await writeFeatures(
      admin,
      context.userId,
      (current) => applyFeatureFlag(current, change),
      {
        action: "ai.feature_flag_set",
        targetId: feature,
        reason: data.reason ?? null,
        after: { feature, enabled: data.enabled, cohorts: data.cohorts },
      },
    );

    return { config, flag: config.features.features[feature] };
  });
