/**
 * Canonical host-responsibility acknowledgments and game policy model.
 *
 * Everything in this file is CONFIGURABLE COPY. All legal-flavoured strings are
 * placeholders marked with `LEGAL_REVIEW_LABEL` and must be reviewed by counsel
 * before launch.
 *
 * IMPORTANT (legal):
 * - ballaCity does NOT organize, supervise, or guarantee the safety of any game.
 * - Host acknowledgments are a plain-language notice of responsibility. They are
 *   NOT a waiver or release of liability and are not universally enforceable.
 */

import { LEGAL_REVIEW_LABEL, SAFETY_ACK_VERSION } from "@/lib/safety";

export { LEGAL_REVIEW_LABEL, SAFETY_ACK_VERSION };

/** Bump when the host acknowledgment list changes. Stored with each consent. */
export const HOST_POLICY_VERSION = SAFETY_ACK_VERSION;

export type HostAckItem = {
  id: string;
  /** Short label — keep to a few words. */
  label: string;
  /** One concise sentence. */
  text: string;
};

/**
 * The configurable host acknowledgments shown during game creation. Concise by
 * design: one line each, one checkbox for the whole set.
 */
export const HOST_ACK_ITEMS: HostAckItem[] = [
  {
    id: "info",
    label: "Accurate game info",
    text: "Sport, date, time, and skill level are correct, and I'll update them if they change.",
  },
  {
    id: "location",
    label: "Accurate location",
    text: "The venue is real, I'm allowed to use it, and players can find it.",
  },
  {
    id: "limit",
    label: "Player limit",
    text: "I won't take more players than the space and my limit allow.",
  },
  {
    id: "rules",
    label: "Game rules",
    text: "I'll post the format and house rules players need before they join.",
  },
  {
    id: "cancellation",
    label: "Cancellation",
    text: "I'll tell players promptly if I cancel, move, or reschedule.",
  },
  {
    id: "facility",
    label: "Facility rules",
    text: "I'll share entry, parking, and facility rules and follow staff instructions.",
  },
  {
    id: "conduct",
    label: "Participant conduct",
    text: "I'll set the conduct I expect and report unsafe behavior.",
  },
  {
    id: "payment",
    label: "Payment info",
    text: "Any fee, deadline, and refund terms I post are accurate — I collect payment directly, not ballaCity.",
  },
];

/** Single checkbox label covering the whole acknowledgment set. */
export const HOST_ACK_CHECKBOX_LABEL =
  "I understand I'm organizing this game and that the details, policies, and conduct are my responsibility.";

/** Configurable legal copy — pending review. */
export const HOST_ACK_DISCLAIMER =
  "ballaCity does not organize, supervise, or guarantee the safety of any game. This acknowledgment is a statement of host responsibility, not a waiver or release of liability, and may not be enforceable everywhere.";

// ---------------------------------------------------------------------------
// Cancellation policy
// ---------------------------------------------------------------------------

export const CANCELLATION_POLICIES = [
  {
    id: "flexible",
    label: "Flexible",
    short: "Cancel anytime",
    text: "Players can drop out any time before start. Refunds, if a fee was paid, are at the host's discretion.",
  },
  {
    id: "standard",
    label: "Standard",
    short: "Cancel 24h ahead",
    text: "Players should drop out at least 24 hours before start so the host can fill the spot.",
  },
  {
    id: "strict",
    label: "Strict",
    short: "No late cancels",
    text: "Spots are committed once approved. Late drop-outs may not be refunded and can affect reliability.",
  },
  {
    id: "custom",
    label: "Custom",
    short: "Host's own policy",
    text: "The host set their own cancellation terms — read them below.",
  },
] as const;

export type CancellationPolicyId = (typeof CANCELLATION_POLICIES)[number]["id"];

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicyId = "flexible";

export function isCancellationPolicyId(v: unknown): v is CancellationPolicyId {
  return CANCELLATION_POLICIES.some((p) => p.id === v);
}

export function cancellationPolicyMeta(id: string | null | undefined) {
  const found = CANCELLATION_POLICIES.find((p) => p.id === id);
  return found ?? CANCELLATION_POLICIES[0];
}

/** Player-facing sentence for a game's cancellation policy. */
export function describeCancellationPolicy(input: {
  policy?: string | null;
  notes?: string | null;
}): string {
  const meta = cancellationPolicyMeta(input.policy);
  const notes = (input.notes ?? "").trim();
  if (meta.id === "custom") return notes || CANCELLATION_POLICIES[0].text;
  return notes ? `${meta.text} ${notes}` : meta.text;
}

// ---------------------------------------------------------------------------
// Game policy model
// ---------------------------------------------------------------------------

export type GamePolicy = {
  cancellationPolicy: CancellationPolicyId;
  cancellationNotes: string;
  minPlayers: number;
  maxPlayers: number;
  allowWaitlist: boolean;
  /** Entry fee in dollars; 0 = free. */
  entryFee: number;
  requiresApproval: boolean;
  refundPolicy: string;
  gameRules: string;
};

export const MAX_GAME_PLAYERS = 30;
export const MIN_GAME_PLAYERS = 2;

export function defaultGamePolicy(maxPlayers = 10): GamePolicy {
  return {
    cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
    cancellationNotes: "",
    minPlayers: 0,
    maxPlayers,
    allowWaitlist: true,
    entryFee: 0,
    requiresApproval: true,
    refundPolicy: "",
    gameRules: "",
  };
}

/** Coerce arbitrary stored values into a safe policy object. */
export function normalizeGamePolicy(input: Partial<GamePolicy> | null | undefined): GamePolicy {
  const base = defaultGamePolicy();
  const maxPlayers = clamp(
    Math.round(Number(input?.maxPlayers ?? base.maxPlayers) || base.maxPlayers),
    MIN_GAME_PLAYERS,
    MAX_GAME_PLAYERS,
  );
  const rawMin = Math.round(Number(input?.minPlayers ?? 0) || 0);
  return {
    cancellationPolicy: isCancellationPolicyId(input?.cancellationPolicy)
      ? input!.cancellationPolicy!
      : DEFAULT_CANCELLATION_POLICY,
    cancellationNotes: (input?.cancellationNotes ?? "").trim(),
    minPlayers: clamp(rawMin, 0, maxPlayers),
    maxPlayers,
    allowWaitlist: input?.allowWaitlist ?? true,
    entryFee: Math.max(0, Number(input?.entryFee ?? 0) || 0),
    requiresApproval: input?.requiresApproval ?? true,
    refundPolicy: (input?.refundPolicy ?? "").trim(),
    gameRules: (input?.gameRules ?? "").trim(),
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export type PolicyValidation = { ok: true } | { ok: false; error: string };

export function validateGamePolicy(policy: GamePolicy): PolicyValidation {
  if (policy.maxPlayers < MIN_GAME_PLAYERS) {
    return { ok: false, error: `A game needs at least ${MIN_GAME_PLAYERS} spots.` };
  }
  if (policy.minPlayers < 0) {
    return { ok: false, error: "Minimum players can't be negative." };
  }
  if (policy.minPlayers > policy.maxPlayers) {
    return { ok: false, error: "Minimum players can't be more than the player limit." };
  }
  if (policy.cancellationPolicy === "custom" && !policy.cancellationNotes.trim()) {
    return { ok: false, error: "Describe your custom cancellation policy." };
  }
  if (policy.entryFee > 0 && !policy.requiresApproval && !policy.refundPolicy.trim()) {
    // Not fatal for publishing, but paid games should say something about refunds.
    return { ok: false, error: "Add refund information for a paid game." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Participant-facing summary
// ---------------------------------------------------------------------------

export type PolicyLine = {
  id: string;
  label: string;
  value: string;
  /** Critical lines are shown first and never collapsed. */
  critical?: boolean;
};

/**
 * The policy lines a player must be able to read BEFORE joining. Ordered so the
 * critical ones (payment, approval, cancellation) come first.
 */
export function gamePolicyLines(policy: GamePolicy): PolicyLine[] {
  const lines: PolicyLine[] = [];

  lines.push({
    id: "payment",
    label: "Payment",
    critical: true,
    value:
      policy.entryFee > 0
        ? `$${formatMoney(policy.entryFee)} per player, paid directly to the host. ballaCity doesn't process payments.`
        : "Free to join — the host isn't collecting an entry fee here.",
  });

  lines.push({
    id: "approval",
    label: "Joining",
    critical: true,
    value: policy.requiresApproval
      ? "The host approves each request before your spot is confirmed."
      : "Spots are first come, first served — no approval needed.",
  });

  lines.push({
    id: "cancellation",
    label: "Cancellation",
    critical: true,
    value: describeCancellationPolicy({
      policy: policy.cancellationPolicy,
      notes: policy.cancellationNotes,
    }),
  });

  if (policy.entryFee > 0) {
    lines.push({
      id: "refund",
      label: "Refunds",
      critical: true,
      value:
        policy.refundPolicy ||
        "The host hasn't posted refund terms — ask before you pay, since ballaCity can't issue refunds.",
    });
  }

  lines.push({
    id: "players",
    label: "Players",
    value:
      policy.minPlayers > 0
        ? `${policy.minPlayers}–${policy.maxPlayers} players. The host may call it off below ${policy.minPlayers}.`
        : `Up to ${policy.maxPlayers} players.`,
  });

  lines.push({
    id: "waitlist",
    label: "Waitlist",
    value: policy.allowWaitlist
      ? "When it's full you can join the waitlist and take a spot if someone drops."
      : "No waitlist — once it's full, it's closed.",
  });

  if (policy.gameRules) {
    lines.push({ id: "rules", label: "Game rules", value: policy.gameRules });
  }

  return lines;
}

/** One-line teaser used on cards and above the join button. */
export function gamePolicyTeaser(policy: GamePolicy): string {
  const bits: string[] = [];
  bits.push(policy.entryFee > 0 ? `$${formatMoney(policy.entryFee)} entry` : "Free");
  bits.push(policy.requiresApproval ? "Host approval" : "Instant join");
  bits.push(cancellationPolicyMeta(policy.cancellationPolicy).short);
  return bits.join(" · ");
}

export function formatMoney(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Host trust info
// ---------------------------------------------------------------------------

export type HostTrust = {
  /** Games this host has published (completed + upcoming). */
  gamesHosted: number;
  /** Average review rating, or null when there aren't any reviews yet. */
  rating: number | null;
  reviewCount: number;
  /**
   * Share of confirmed participants that actually showed up, 0–1, or null when
   * the app has no attendance signal for this host.
   */
  attendanceRate: number | null;
  /** True ONLY when a real verification record exists. */
  verified: boolean;
  /** What the verification actually covers, when verified. */
  verifiedLabel?: string | null;
};

export type HostTrustStat = { id: string; label: string; value: string; hint?: string };

/**
 * Trust stats to display. Unknown signals are reported as "Not enough data"
 * rather than an invented number, and no verification badge is emitted unless
 * `verified` is true.
 */
export function hostTrustStats(trust: HostTrust): HostTrustStat[] {
  const stats: HostTrustStat[] = [
    {
      id: "hosted",
      label: "Games hosted",
      value: trust.gamesHosted > 0 ? String(trust.gamesHosted) : "First game",
    },
    {
      id: "rating",
      label: "Host rating",
      value:
        trust.rating != null && trust.reviewCount > 0
          ? `${trust.rating.toFixed(1)} ★`
          : "No reviews yet",
      hint:
        trust.rating != null && trust.reviewCount > 0
          ? `${trust.reviewCount} review${trust.reviewCount === 1 ? "" : "s"}`
          : undefined,
    },
  ];

  stats.push({
    id: "attendance",
    label: "Attendance",
    value:
      trust.attendanceRate == null
        ? "Not enough data"
        : `${Math.round(trust.attendanceRate * 100)}% showed up`,
  });

  return stats;
}

export function hostVerificationLabel(trust: HostTrust): string | null {
  if (!trust.verified) return null;
  return trust.verifiedLabel?.trim() || "Verified team profile";
}
