import { cutoffAmountLabel } from "@/lib/live-status";
import { normalizeCutoff } from "@/lib/cancel-window";

/**
 * Refund policies. BallaCity never moves money — players pay hosts directly —
 * so a policy is the host's rule for what a player gets back. The database
 * applies the same rule (`refund_pct_for`) when a player cancels, no-shows,
 * or the host cancels; this module is the client's copy, used for settings
 * and for the plain-language terms players agree to before paying.
 *
 * The time frame is the event's cancellation cutoff.
 */

export type RefundRule = "until_cutoff" | "before_start" | "none";

export const DEFAULT_REFUND_RULE: RefundRule = "until_cutoff";

export const REFUND_RULE_OPTIONS: { value: RefundRule; label: string }[] = [
  { value: "until_cutoff", label: "Refundable until the cancellation cutoff" },
  { value: "before_start", label: "Refundable any time before start" },
  { value: "none", label: "Non-refundable" },
];

/** Share refunded for late cancels / no-shows. 0 = the host keeps the fee. */
export const PARTIAL_REFUND_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Keep the full fee" },
  { value: 25, label: "Refund 25%" },
  { value: 50, label: "Refund 50%" },
  { value: 75, label: "Refund 75%" },
];

export type RefundPolicy = { rule: RefundRule; latePct: number };

export function normalizeRefundPolicy(
  rule: string | null | undefined,
  latePct: number | null | undefined,
): RefundPolicy {
  const r: RefundRule =
    rule === "before_start" || rule === "none" || rule === "until_cutoff"
      ? rule
      : DEFAULT_REFUND_RULE;
  const n = Math.round(Number(latePct));
  return { rule: r, latePct: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0 };
}

export type RefundReason = "player_cancelled" | "no_show" | "game_cancelled";
/** early: before the cutoff · late: inside it · started: at or after start. */
export type RefundPhase = "early" | "late" | "started";

/** Mirrors `refund_pct_for` in the database. */
export function refundPctFor(
  policy: RefundPolicy,
  reason: RefundReason,
  phase: RefundPhase,
): number {
  if (reason === "game_cancelled") return 100;
  if (policy.rule === "none") return 0;
  if (reason === "no_show") return policy.latePct;
  if (policy.rule === "before_start") return phase === "started" ? policy.latePct : 100;
  return phase === "early" ? 100 : policy.latePct;
}

export function refundPhase(
  startsAt: string | Date | null | undefined,
  cutoffMin: number | null | undefined,
  now: number = Date.now(),
): RefundPhase {
  if (!startsAt) return "early";
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return "early";
  if (now >= start) return "started";
  const cutoff = normalizeCutoff(cutoffMin);
  return cutoff > 0 && now >= start - cutoff * 60_000 ? "late" : "early";
}

function lateShare(pct: number): string {
  return pct > 0 ? `you get ${pct}% back` : "the fee is non-refundable";
}

/** Plain-language terms, e.g. for the pay page and event pages. */
export function refundPolicySummary(
  policy: RefundPolicy,
  cutoffMin: number | null | undefined,
): string {
  const cutoff = normalizeCutoff(cutoffMin);
  if (policy.rule === "none") {
    return "This fee is non-refundable once paid, including if you cancel or don't show up. If the host cancels, you get a full refund.";
  }
  if (policy.rule === "before_start" || cutoff <= 0) {
    return `Full refund if you cancel any time before start. If you don't show up, ${lateShare(policy.latePct)}. If the host cancels, you get a full refund.`;
  }
  return `Full refund if you cancel more than ${cutoffAmountLabel(cutoff)} before start. After that, or if you don't show up, ${lateShare(policy.latePct)}. If the host cancels, you get a full refund.`;
}

/** The statement a player ticks before paying or committing to a paid spot. */
export function refundDisclaimer(
  policy: RefundPolicy,
  cutoffMin: number | null | undefined,
  hostNote?: string | null,
): string {
  const note = hostNote?.trim();
  return `I understand the refund terms: ${refundPolicySummary(policy, cutoffMin)}${note ? ` Host's note: ${note}` : ""} Refunds come from the host directly — BallaCity doesn't hold or return money.`;
}

/** The refund fields players are allowed to see before joining. */
export type RefundTerms = {
  refund_rule?: string | null;
  late_refund_pct?: number | null;
  refund_policy?: string | null;
};

/**
 * What to show players: the host's structured rule as a summary, and their own
 * words kept separate (and labeled) so they're never read as part of the
 * generated sentence. `null` terms means the host hasn't posted any — never
 * invent a default rule for the player to rely on.
 */
export function refundTermsDisplay(
  terms: RefundTerms | null | undefined,
  cutoffMin: number | null | undefined,
): { summary: string; hostNote: string } | null {
  if (!terms) return null;
  return {
    summary: refundPolicySummary(
      normalizeRefundPolicy(terms.refund_rule, terms.late_refund_pct),
      cutoffMin,
    ),
    hostNote: terms.refund_policy?.trim() ?? "",
  };
}
