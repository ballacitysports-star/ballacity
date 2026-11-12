/**
 * Server-side notification curfew for minors.
 *
 * The policy itself (window, cohorts, guardian override) lives in
 * `child-policy.ts` — this module only resolves the recipient's cohort,
 * guardian controls, timezone and active policy, then asks the policy engine.
 *
 * LEGAL REVIEW REQUIRED — the default window models NY's SAFE for Kids Act
 * (12am–6am recipient local time) because it is the more protective of the
 * windows we know about. Implementing a window is not a compliance claim.
 */

import {
  DEFAULT_AGE_POLICY,
  notificationCurfewDecision,
  parseAgePolicy,
  parseChildControls,
  parseCohort,
  type AgePolicyConfig,
  type CurfewDecision,
} from "@/lib/child-policy";

export type CurfewGate =
  | { action: "send" }
  /** Guardian turned notifications off entirely — a stricter, separate layer. */
  | { action: "blocked"; reason: "guardian_notifications_off" }
  | { action: "queue"; deliverAfter: string; decision: CurfewDecision };

type Admin = {
  from: (table: string) => any;
};

/**
 * The active age policy, or the default when none is stored. Throws when the lookup fails: a
 * stored window may be stricter than the default, so the default is never used on a guess.
 */
export async function loadAgePolicy(admin: Admin): Promise<AgePolicyConfig> {
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "age_policy")
    .maybeSingle();
  if (error) throw new Error(`age policy lookup failed: ${error.message}`);
  return data ? parseAgePolicy((data as { value: unknown }).value) : { ...DEFAULT_AGE_POLICY };
}

/**
 * Decide whether a push may go out to this user right now. Adults always send.
 * Minors inside the curfew are QUEUED, never dropped — the in-app notification
 * row is written by the caller regardless, so nothing is silently lost.
 *
 * Fails CLOSED: if any lookup (policy, profile, guardian controls) errors or
 * throws, this throws rather than guess. A failed profile read must not make a
 * minor look like an adult, nor a failed controls read hide a guardian's off
 * switch. Callers hold the push when it throws: deliverPush queues it for the
 * flush job, and the flush job keeps a queued row waiting and retries.
 */
export async function curfewGateFor(
  admin: Admin,
  userId: string,
  now: Date = new Date(),
): Promise<CurfewGate> {
  const [policy, profileRes, controlsRes] = await Promise.all([
    loadAgePolicy(admin),
    admin.from("profiles").select("age_cohort, timezone").eq("id", userId).maybeSingle(),
    admin
      .from("child_controls")
      .select("notifications, notification_curfew_lifted")
      .eq("child_user_id", userId)
      .maybeSingle(),
  ]);
  if (!profileRes || profileRes.error) {
    throw new Error(`profile lookup failed: ${profileRes?.error?.message ?? "no response"}`);
  }
  if (!controlsRes || controlsRes.error) {
    throw new Error(
      `guardian controls lookup failed: ${controlsRes?.error?.message ?? "no response"}`,
    );
  }

  const cohort = parseCohort((profileRes?.data as any)?.age_cohort);
  const timezone = ((profileRes?.data as any)?.timezone as string | null) ?? null;
  const controlsRow = (controlsRes?.data as Record<string, unknown> | null) ?? null;
  const controls = controlsRow ? parseChildControls(controlsRow) : null;

  const decision = notificationCurfewDecision({
    cohort,
    curfewLifted: controls?.notificationCurfewLifted ?? false,
    timezone,
    now,
    config: policy,
  });

  // Guardian's on/off switch is an independent, more restrictive layer that
  // applies whether or not the curfew is in effect.
  if (controls && !controls.notifications && decision.reason !== "not_a_minor") {
    return { action: "blocked", reason: "guardian_notifications_off" };
  }

  if (decision.send) return { action: "send" };
  return {
    action: "queue",
    deliverAfter: (decision.deliverAfter ?? now).toISOString(),
    decision,
  };
}
