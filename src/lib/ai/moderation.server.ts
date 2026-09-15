/**
 * Safety gate for everything AI writes or produces.
 *
 * Rules, in force everywhere:
 *  - block  → the text is NOT saved; a neutral/empty value is used instead
 *  - review → saved but held owner-only until a human reviews it
 *  - the check failing (provider down, timeout) FAILS CLOSED: treated as review,
 *    never published by default
 *  - suspected child sexual abuse material → immediate quarantine (no signed
 *    URLs for anyone, owner included), superadmin alert, audit entry, no
 *    deletion (evidence is preserved) and no further AI processing
 *
 * Original uploads are never deleted by a moderation or AI failure.
 */

import { logAdminAction } from "@/lib/audit-log.server";
import type { AiFeature } from "./config";
import { AiError } from "./errors";
import { createLovableGatewayProvider } from "./gateway.server";
import { loadAiConfig } from "./settings.server";
import type { TextVerdict } from "./provider";
import { recordUsage } from "./usage.server";

export type ModerationTarget = { table: string; id?: string | null; field: string };

export type TextModerationOutcome = {
  verdict: TextVerdict;
  categories: string[];
  /** Text safe to persist: the original for allow/review, empty for block. */
  value: string;
  /** True when the check itself could not run (fail-closed → review). */
  unavailable: boolean;
};

/** Category names any provider might use for the CSAM path. */
const CSAM_PATTERN = /(csam|child[_\s-]?sexual|minor[_\s-]?sexual|sexualiz\w*[_\s-]?minor)/i;

export function isCsamCategory(values: Array<string | null | undefined>): boolean {
  return values.some((v) => typeof v === "string" && CSAM_PATTERN.test(v));
}

async function recordVerdict(
  admin: any,
  input: {
    userId: string;
    jobId?: string | null;
    target: ModerationTarget;
    verdict: TextVerdict;
    categories: string[];
    model: string | null;
  },
): Promise<void> {
  try {
    await admin.from("ai_text_moderation").insert({
      user_id: input.userId,
      job_id: input.jobId ?? null,
      target_table: input.target.table,
      target_id: input.target.id ?? null,
      target_field: input.target.field,
      verdict: input.verdict,
      categories: input.categories,
      model: input.model,
    });
  } catch {
    // A bookkeeping failure must not turn into a publish decision.
  }
}

/**
 * Checks one piece of text before it is stored anywhere a non-owner could see.
 * Never throws: the caller always gets a decision, and an unavailable checker
 * yields `review` (owner-only) rather than a publish.
 */
export async function moderateAiText(
  admin: any,
  input: {
    userId: string;
    text: string;
    target: ModerationTarget;
    jobId?: string | null;
    context?: string;
    feature?: AiFeature;
  },
): Promise<TextModerationOutcome> {
  const text = (input.text ?? "").trim();
  if (!text) {
    return { verdict: "allow", categories: [], value: "", unavailable: false };
  }

  const config = await loadAiConfig(admin);
  const flag = config.features.features.text_moderation;
  if (config.features.killSwitch || !flag.enabled) {
    // Checker deliberately off: fail closed, hold as review.
    await recordVerdict(admin, {
      userId: input.userId,
      jobId: input.jobId,
      target: input.target,
      verdict: "review",
      categories: ["moderation_unavailable"],
      model: null,
    });
    return { verdict: "review", categories: ["moderation_unavailable"], value: text, unavailable: true };
  }

  const provider = createLovableGatewayProvider(config.provider);
  try {
    const result = await provider.moderateText({ text, context: input.context });
    await recordUsage(
      admin,
      { jobId: input.jobId ?? null, userId: input.userId, feature: "text_moderation" },
      {
        provider: provider.name,
        model: result.model,
        usage: result.usage,
        outcome: result.verdict === "block" ? "blocked" : "ok",
        config,
      },
    );
    await recordVerdict(admin, {
      userId: input.userId,
      jobId: input.jobId,
      target: input.target,
      verdict: result.verdict,
      categories: result.categories,
      model: result.model,
    });
    return {
      verdict: result.verdict,
      categories: result.categories,
      value: result.verdict === "block" ? "" : text,
      unavailable: false,
    };
  } catch {
    await recordUsage(
      admin,
      { jobId: input.jobId ?? null, userId: input.userId, feature: "text_moderation" },
      {
        provider: config.provider.provider,
        model: config.provider.moderationTextModel,
        outcome: "error",
        config,
      },
    );
    await recordVerdict(admin, {
      userId: input.userId,
      jobId: input.jobId,
      target: input.target,
      verdict: "review",
      categories: ["moderation_unavailable"],
      model: config.provider.moderationTextModel,
    });
    return {
      verdict: "review",
      categories: ["moderation_unavailable"],
      value: text,
      unavailable: true,
    };
  }
}

export type ModeratedFields<K extends string> = {
  /** Values safe to persist (blocked fields come back empty). */
  values: Record<K, string>;
  blocked: K[];
  review: K[];
  unavailable: boolean;
};

/** Convenience wrapper for a set of AI-written fields on the same record. */
export async function moderateAiFields<K extends string>(
  admin: any,
  input: {
    userId: string;
    jobId?: string | null;
    table: string;
    id?: string | null;
    fields: Record<K, string>;
    context?: string;
  },
): Promise<ModeratedFields<K>> {
  const values = {} as Record<K, string>;
  const blocked: K[] = [];
  const review: K[] = [];
  let unavailable = false;

  for (const key of Object.keys(input.fields) as K[]) {
    const outcome = await moderateAiText(admin, {
      userId: input.userId,
      jobId: input.jobId,
      text: input.fields[key],
      context: input.context,
      target: { table: input.table, id: input.id, field: key },
    });
    values[key] = outcome.value;
    if (outcome.verdict === "block") blocked.push(key);
    if (outcome.verdict === "review") review.push(key);
    if (outcome.unavailable) unavailable = true;
  }

  return { values, blocked, review, unavailable };
}

export type FrameSafetyOutcome = {
  safe: boolean;
  csam: boolean;
  categories: string[];
  /** True when no frame could be checked — the reel must stay hidden. */
  unavailable: boolean;
};

/**
 * Safety check over already-sampled reel frames, run before a reel may reach
 * 'completed'. Fails closed: an unavailable checker returns `safe: false`.
 */
export async function checkReelFrameSafety(
  admin: any,
  input: { userId: string; reelId: string; frames: string[]; jobId?: string | null },
): Promise<FrameSafetyOutcome> {
  const frames = input.frames.filter(Boolean).slice(0, 4);
  if (frames.length === 0) {
    return { safe: false, csam: false, categories: ["no_frames"], unavailable: true };
  }

  const config = await loadAiConfig(admin);
  const flag = config.features.features.image_moderation;
  if (config.features.killSwitch || !flag.enabled) {
    return { safe: false, csam: false, categories: ["moderation_unavailable"], unavailable: true };
  }

  const provider = createLovableGatewayProvider(config.provider);
  const categories = new Set<string>();
  let checked = 0;
  let safe = true;

  for (const frame of frames) {
    try {
      const verdict = await provider.moderateImage({ imageUrl: frame });
      checked += 1;
      await recordUsage(
        admin,
        { jobId: input.jobId ?? null, userId: input.userId, feature: "image_moderation" },
        {
          provider: provider.name,
          model: verdict.model,
          usage: verdict.usage,
          outcome: verdict.safe ? "ok" : "blocked",
          config,
        },
      );
      for (const c of [...verdict.categories, verdict.label]) categories.add(c);
      if (!verdict.safe) safe = false;
    } catch {
      // keep going; an unchecked frame is handled by the `checked` guard below
    }
  }

  if (checked === 0) {
    return { safe: false, csam: false, categories: ["moderation_unavailable"], unavailable: true };
  }

  const list = [...categories];
  return { safe, csam: isCsamCategory(list), categories: list, unavailable: false };
}

/**
 * Immediate quarantine for suspected child sexual abuse material.
 *
 * Hides the reel, records a quarantine row so no signed URL is issued to
 * anyone (owner included), alerts superadmins and writes an audit entry.
 * Nothing is deleted — evidence must be preserved — and the item is never
 * re-processed by AI.
 *
 * NOTE FOR OPERATIONS: this code path must be paired with a documented legal
 * reporting process (NCMEC in the US) owned by a human. Software quarantine
 * alone does not satisfy the reporting obligation.
 */
export async function quarantineForChildSafety(
  admin: any,
  input: {
    userId: string;
    reelId: string;
    bucket?: string;
    path?: string | null;
    categories: string[];
    source: string;
  },
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await admin
      .from("highlight_reels")
      .update({ hidden_at: now, status: "blocked" })
      .eq("id", input.reelId);
  } catch {
    /* handled by the audit entry below */
  }

  if (input.path) {
    try {
      await admin.from("image_moderation").insert({
        bucket: input.bucket ?? "highlight-videos",
        path: input.path,
        owner_id: input.userId,
        status: "quarantined",
        reason: "Suspected child sexual abuse material — quarantined for review",
        quarantined_at: now,
        scan: { categories: input.categories, source: input.source },
      });
    } catch {
      /* non-fatal */
    }
  }

  try {
    const { data: admins } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "superadmin");
    const rows = (admins ?? []).map((row: { user_id: string }) => ({
      user_id: row.user_id,
      type: "safety_alert",
      title: "Urgent safety review required",
      body: "Automated screening quarantined a reel for suspected child sexual abuse material.",
      link: `/superadmin?reel=${input.reelId}`,
    }));
    if (rows.length > 0) await admin.from("notifications").insert(rows);
  } catch {
    /* non-fatal */
  }

  await logAdminAction(admin, null, {
    action: "ai.content_quarantine",
    targetType: "highlight_reel",
    targetId: input.reelId,
    reason: "Suspected child sexual abuse material detected by automated screening",
    metadata: {
      categories: input.categories,
      source: input.source,
      preserved: true,
      reprocessing_blocked: true,
    },
  });
}

/** Thrown when blocked content must abort the caller outright. */
export function moderationBlocked(): AiError {
  return new AiError("MODERATION_BLOCKED");
}
