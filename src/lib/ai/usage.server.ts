/**
 * Job and usage bookkeeping for every AI call.
 *
 * A job row is created by the atomic quota reservation (see `gate.server.ts`),
 * then progressed, heart-beaten and finished here. Every provider call records
 * an `ai_usage_events` row — including failures and blocks — so admin analytics
 * and quota accounting see the same truth.
 */

import { estimateCostCents, type AiConfig, type AiFeature } from "./config";
import { safeLogValue, toAiError, type AiErrorCode } from "./errors";
import type { AiTokenUsage } from "./provider";

export type UsageOutcome = "ok" | "error" | "blocked" | "quota_denied";

export type AiJobRef = {
  jobId: string | null;
  userId: string;
  feature: AiFeature;
};

export async function recordUsage(
  admin: any,
  ref: AiJobRef,
  input: {
    provider: string;
    model: string;
    usage?: AiTokenUsage;
    units?: number;
    outcome: UsageOutcome;
    config: AiConfig;
  },
): Promise<void> {
  const usage = input.usage ?? { inputTokens: 0, outputTokens: 0 };
  const est = estimateCostCents(
    input.config.pricing,
    input.model,
    usage.inputTokens,
    usage.outputTokens,
  );
  try {
    await admin.from("ai_usage_events").insert({
      user_id: ref.userId,
      job_id: ref.jobId,
      feature: ref.feature,
      units: Math.max(1, input.units ?? 1),
      provider: input.provider,
      model: input.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      est_cost_cents: est,
      outcome: input.outcome,
    });
  } catch {
    // Bookkeeping must never break the feature it is measuring.
  }
}

export async function touchJob(
  admin: any,
  jobId: string | null,
  patch: Record<string, unknown> = {},
): Promise<void> {
  if (!jobId) return;
  try {
    await admin
      .from("ai_generation_jobs")
      .update({ heartbeat_at: new Date().toISOString(), ...patch })
      .eq("id", jobId);
  } catch {
    /* non-fatal */
  }
}

export async function setJobProgress(
  admin: any,
  jobId: string | null,
  progress: Record<string, unknown>,
): Promise<void> {
  await touchJob(admin, jobId, { progress: safeLogValue(progress) as Record<string, unknown> });
}

export async function finishJob(
  admin: any,
  jobId: string | null,
  result:
    | { status: "succeeded" }
    | { status: "failed" | "cancelled" | "blocked"; code: AiErrorCode; message: string },
): Promise<void> {
  if (!jobId) return;
  const patch: Record<string, unknown> = {
    status: result.status,
    finished_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
  };
  if (result.status !== "succeeded") {
    patch["error_code"] = result.code;
    patch["user_message"] = result.message;
  }
  try {
    await admin.from("ai_generation_jobs").update(patch).eq("id", jobId);
  } catch {
    /* non-fatal */
  }
}

/** Marks a job failed from any thrown value, keeping only client-safe text. */
export async function failJob(admin: any, jobId: string | null, e: unknown): Promise<void> {
  const err = toAiError(e);
  await finishJob(admin, jobId, {
    status: "failed",
    code: err.code,
    message: err.userMessage,
  });
}

export async function addJobCost(
  admin: any,
  jobId: string | null,
  cents: number,
  provider: string,
  model: string,
): Promise<void> {
  if (!jobId || cents <= 0) return;
  try {
    const { data } = await admin
      .from("ai_generation_jobs")
      .select("est_cost_cents")
      .eq("id", jobId)
      .maybeSingle();
    const current = Number(data?.est_cost_cents ?? 0);
    await admin
      .from("ai_generation_jobs")
      .update({
        est_cost_cents: Math.round((current + cents) * 10000) / 10000,
        provider,
        model,
        heartbeat_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch {
    /* non-fatal */
  }
}
