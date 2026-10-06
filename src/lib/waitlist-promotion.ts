/** Shared (client + server) pieces of waitlist promotion. */

/** How long a paid / approval-required run holds a freed spot for the next player. */
export const OFFER_WINDOW_MINUTES = 30;

export type PromotionOutcomeKind = "promoted" | "offered" | "expired" | "declined";

export type PromotionOutcome = {
  entryId: string;
  userId: string;
  outcome: PromotionOutcomeKind;
  position: string;
  expiresAt: string | null;
  gameTitle: string;
};

export type ClaimResult = "joined" | "pay" | "expired";

const KINDS: ReadonlySet<string> = new Set(["promoted", "offered", "expired", "declined"]);

/** Narrow the jsonb the promotion RPC returns; ignores anything malformed. */
export function parsePromotionOutcomes(raw: unknown): PromotionOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: PromotionOutcome[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (
      typeof o["entryId"] !== "string" ||
      typeof o["userId"] !== "string" ||
      typeof o["outcome"] !== "string" ||
      !KINDS.has(o["outcome"])
    ) {
      continue;
    }
    out.push({
      entryId: o["entryId"],
      userId: o["userId"],
      outcome: o["outcome"] as PromotionOutcomeKind,
      position: typeof o["position"] === "string" ? o["position"] : "",
      expiresAt: typeof o["expiresAt"] === "string" ? o["expiresAt"] : null,
      gameTitle: typeof o["gameTitle"] === "string" ? o["gameTitle"] : "your game",
    });
  }
  return out;
}

export type PromotionNotification = {
  type: string;
  title: string;
  body: string;
};

/** The alert a player gets for an outcome, or null when they should not be told. */
export function promotionNotification(o: PromotionOutcome): PromotionNotification | null {
  switch (o.outcome) {
    case "promoted":
      return {
        type: "waitlist_promoted",
        title: `A spot opened up for ${o.gameTitle}!`,
        body: "You're on the roster.",
      };
    case "offered":
      return {
        type: "waitlist_offer",
        title: `A spot opened up for ${o.gameTitle}!`,
        body: `Claim your spot within ${OFFER_WINDOW_MINUTES} minutes before it goes to the next player.`,
      };
    case "expired":
      return {
        type: "waitlist_offer_expired",
        title: `Your spot for ${o.gameTitle} was released`,
        body: "The claim window ran out, so the spot went to the next player.",
      };
    default:
      return null;
  }
}

export function offerSecondsRemaining(expiresAt: string | null, now: number = Date.now()): number {
  if (!expiresAt) return 0;
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

/** 1830 -> "30:30", 59 -> "0:59". */
export function formatOfferCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** "You're #1 on the waitlist" / "You're #3 on the Guard waitlist". */
export function waitlistRankLabel(rank: number, position?: string | null): string {
  const where = position && position.trim() ? `the ${position.trim()} waitlist` : "the waitlist";
  return `You're #${rank} on ${where}`;
}
