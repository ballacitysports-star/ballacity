/**
 * Canonical peer-to-peer payment lifecycle.
 *
 * ballaCity never touches money: players pay hosts directly inside Venmo / Zelle /
 * Cash App / PayPal / cash, and the host manually confirms. Every payment UI in
 * the app derives its wording from this module so there is exactly one vocabulary.
 */

export const PAYMENT_STATES = [
  "payment_required",
  "instructions_shown",
  "payment_sent",
  "host_confirmation_pending",
  "confirmed",
  "disputed",
  "cancelled",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Statuses stored on `payment_submissions.status`. */
export type PaymentSubmissionStatus =
  "pending" | "verified" | "rejected" | "disputed" | "cancelled";

export const CANCELLATION_REASONS = [
  "host_cancelled",
  "player_cancelled",
  "game_cancelled",
  "weather",
  "dispute",
  "other",
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  host_cancelled: "Host cancelled",
  player_cancelled: "Player cancelled",
  game_cancelled: "Game cancelled",
  weather: "Weather",
  dispute: "Payment dispute",
  other: "Other",
};

export function cancellationReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Cancelled";
  return CANCELLATION_REASON_LABELS[reason as CancellationReason] ?? "Cancelled";
}

type StateMeta = {
  /** Short label for badges. */
  label: string;
  /** One-line explanation shown to a player. */
  playerHint: string;
  /** One-line explanation shown to a host. */
  hostHint: string;
  tone: "neutral" | "progress" | "success" | "danger";
};

export const PAYMENT_STATE_META: Record<PaymentState, StateMeta> = {
  payment_required: {
    label: "Payment required",
    playerHint: "This game has a fee. Pay the host directly to lock your spot.",
    hostHint: "Player hasn't started paying yet.",
    tone: "neutral",
  },
  instructions_shown: {
    label: "Instructions shown",
    playerHint: "Follow the host's payment details, then come back and mark it sent.",
    hostHint: "Player has your payment details.",
    tone: "neutral",
  },
  payment_sent: {
    label: "Payment sent",
    playerHint: "You marked this paid and sent your proof to the host.",
    hostHint: "Player says they paid and attached proof.",
    tone: "progress",
  },
  host_confirmation_pending: {
    label: "Awaiting host confirmation",
    playerHint:
      "Only the host can confirm a payment — marking it sent does not confirm it. Give them a little time.",
    hostHint: "Check your payment app, then confirm or decline this claim.",
    tone: "progress",
  },
  confirmed: {
    label: "Confirmed by host",
    playerHint: "The host confirmed your payment. You're all set.",
    hostHint: "You confirmed you received this payment.",
    tone: "success",
  },
  disputed: {
    label: "Disputed",
    playerHint:
      "This payment is disputed. Sort it out with the host in your payment app — ballaCity can't move or refund money.",
    hostHint: "This payment is disputed. Resolve it directly with the player.",
    tone: "danger",
  },
  cancelled: {
    label: "Cancelled",
    playerHint: "This payment claim was cancelled. No money was moved by ballaCity.",
    hostHint: "This payment claim was cancelled.",
    tone: "danger",
  },
};

export function paymentStateLabel(state: PaymentState): string {
  return PAYMENT_STATE_META[state].label;
}

/**
 * Map a stored submission (or the absence of one) onto the canonical state.
 *
 * `instructionsShown` is a client-side signal: the player has seen (or opened)
 * the host's payment details but hasn't claimed payment yet.
 */
export function paymentStateFor(input: {
  feeRequired: boolean;
  submission?: {
    status: PaymentSubmissionStatus | string;
    reviewed_at?: string | null;
  } | null;
  instructionsShown?: boolean;
}): PaymentState {
  const s = input.submission;
  if (s) {
    switch (s.status) {
      case "verified":
        return "confirmed";
      case "disputed":
        return "disputed";
      case "cancelled":
        return "cancelled";
      case "rejected":
        // A declined claim puts the player back on the hook for the fee.
        return input.feeRequired ? "payment_required" : "cancelled";
      case "pending":
      default:
        return "host_confirmation_pending";
    }
  }
  if (!input.feeRequired) return "confirmed";
  return input.instructionsShown ? "instructions_shown" : "payment_required";
}

/** States a player may still act on (send proof, cancel, dispute). */
export function isOpenPaymentState(state: PaymentState): boolean {
  return state !== "confirmed" && state !== "cancelled";
}

export function canPlayerCancel(state: PaymentState): boolean {
  return state === "payment_sent" || state === "host_confirmation_pending";
}

export function canPlayerDispute(state: PaymentState): boolean {
  return state === "host_confirmation_pending" || state === "payment_sent";
}

export function canHostConfirm(state: PaymentState): boolean {
  return state === "payment_sent" || state === "host_confirmation_pending";
}

/* ------------------------------------------------------------------ */
/* Safety copy — single source of truth, reused by every payment view  */
/* ------------------------------------------------------------------ */

/** Shown wherever a player is about to send money. */
export const PAYMENT_DISCLAIMER =
  "ballaCity is not a payment processor. You pay the host directly in their app, and ballaCity cannot hold, move, refund, or reverse that money.";

export const PAYMENT_SAFETY_TIPS: string[] = [
  "Only send the exact game fee — never a deposit, gift card, or crypto transfer.",
  "Never share your card number, CVV, bank login, or one-time codes. No host or ballaCity staff will ever ask.",
  "Keep the payment inside your payment app so it has its own record. Screenshot the confirmation.",
  "If someone pressures you to pay fast, pay off-app, or pay more than the listed fee, stop and report it.",
];

/** Extra warning shown when a host asks for an unusually large amount. */
export const PAYMENT_PRESSURE_WARNING =
  "Pressure to pay immediately, outside the listed fee, or through an unusual channel is the most common scam pattern. Take your time — a real host will wait.";

/** Credential-shaped inputs are never allowed anywhere in the payment flow. */
export const FORBIDDEN_CREDENTIAL_HINT =
  "ballaCity only stores a host's public payment handle (like a Venmo username or a payment link). It never asks for card numbers, bank accounts, routing numbers, or login details.";
