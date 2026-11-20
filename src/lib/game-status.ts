import type { Game } from "@/lib/sample-data";
import { computeLiveStatus } from "@/lib/live-status";
import { gameEndsAt } from "@/lib/game-time";
import { USER_ERROR_MESSAGES, errorText, knownErrorMessage } from "@/lib/user-error";

/**
 * One canonical lifecycle status for a game, used by every surface (cards,
 * lists, map pins, detail header, host dashboard) so a game never reads as
 * "Open" in one place and "Ended" in another.
 *
 * Precedence is deliberate: an explicit host decision (cancelled/completed)
 * always outranks anything derived from the clock or the roster.
 */
export type GameStatus =
  "cancelled" | "completed" | "in_progress" | "starting_soon" | "full" | "closed" | "open";

export type GameStatusTone = "danger" | "muted" | "live" | "warn" | "neutral" | "open";

export type ResolvedGameStatus = {
  status: GameStatus;
  /** Short badge label, e.g. "Cancelled", "Starting soon". */
  label: string;
  /** One-line explanation for helper text, toasts and empty states. */
  detail: string;
  tone: GameStatusTone;
  /** True when no new player can get on the roster right now. */
  joinBlocked: boolean;
  /** True once the game is over or called off — nothing left to act on. */
  terminal: boolean;
};

export type GameStatusInput = Pick<Game, "date" | "duration"> & {
  endsAt?: string | null;
  status?: string | null;
  joinsClosed?: boolean;
  signupCutoffMin?: number;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  completedAt?: string | null;
};

/** Minutes before start when a scheduled game reads as "Starting soon". */
export const STARTING_SOON_MIN = 60;

export function isGameCancelled(game: GameStatusInput): boolean {
  return !!game.cancelledAt || game.status === "cancelled";
}

export function isGameCompleted(game: GameStatusInput, now: number = Date.now()): boolean {
  if (isGameCancelled(game)) return false;
  if (game.completedAt || game.status === "completed") return true;
  return gameEndsAt(game) <= now;
}

export function resolveGameStatus(
  game: GameStatusInput,
  opts: { spotsLeft?: number | undefined; now?: number } = {},
): ResolvedGameStatus {
  const now = opts.now ?? Date.now();

  if (isGameCancelled(game)) {
    return {
      status: "cancelled",
      label: "Cancelled",
      detail: game.cancellationReason?.trim()
        ? `Cancelled by the host — ${game.cancellationReason.trim()}`
        : "The host cancelled this game.",
      tone: "danger",
      joinBlocked: true,
      terminal: true,
    };
  }

  if (isGameCompleted(game, now)) {
    return {
      status: "completed",
      label: "Ended",
      detail: "This game has ended.",
      tone: "muted",
      joinBlocked: true,
      terminal: true,
    };
  }

  const live = computeLiveStatus(game as Game, now);
  if (live === "in_progress") {
    return {
      status: "in_progress",
      label: "In progress",
      detail: "This game is underway — signups are closed.",
      tone: "live",
      joinBlocked: true,
      terminal: false,
    };
  }

  const start = new Date(game.date).getTime();
  const cutoffMin = Number(game.signupCutoffMin ?? 0);
  const cutoffPassed = cutoffMin > 0 && Number.isFinite(start) && now >= start - cutoffMin * 60_000;

  if (game.joinsClosed || cutoffPassed) {
    return {
      status: "closed",
      label: "Signup closed",
      detail: game.joinsClosed
        ? "The host has closed joining for this game."
        : "Signups closed ahead of start time.",
      tone: "warn",
      joinBlocked: true,
      terminal: false,
    };
  }

  if (opts.spotsLeft !== undefined && opts.spotsLeft <= 0) {
    return {
      status: "full",
      label: "Roster full",
      detail: "The roster is full — join the waitlist to get the next opening.",
      tone: "warn",
      joinBlocked: true,
      terminal: false,
    };
  }

  if (Number.isFinite(start) && start - now <= STARTING_SOON_MIN * 60_000) {
    return {
      status: "starting_soon",
      label: "Starting soon",
      detail: "This game starts within the hour.",
      tone: "neutral",
      joinBlocked: false,
      terminal: false,
    };
  }

  return {
    status: "open",
    label: "Open",
    detail: "Spots are available.",
    tone: "open",
    joinBlocked: false,
    terminal: false,
  };
}

/** Tailwind classes per tone, so badges match everywhere. */
export const GAME_STATUS_TONE_CLASS: Record<GameStatusTone, string> = {
  danger: "border-coral/40 bg-coral/10 text-coral",
  muted: "border-border bg-muted text-muted-foreground",
  live: "border-lime/40 bg-lime/10 text-lime",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  neutral: "border-border bg-background text-foreground",
  open: "border-lime/30 bg-lime/5 text-lime",
};

/** Added to a full game's refusal only when the host kept a waitlist (game-policy.ts: "No waitlist" otherwise). */
export const JOIN_WAITLIST_STEP = "You can join the waitlist instead.";

/**
 * Turn a database join-gate rejection into a sentence a player understands.
 * The codes come from the `enforce_game_join_gate` trigger; the sentences from the shared catalog (user-error.ts).
 * Pass the game's `allowWaitlist` to point a player at the waitlist when the game is full; without it the sentence
 * only says the game is full, since a host can turn the waitlist off.
 */
export function joinGateErrorMessage(
  err: unknown,
  game?: { allowWaitlist?: boolean | null },
): string {
  const known = knownErrorMessage(err);
  if (known === USER_ERROR_MESSAGES.GAME_FULL && game?.allowWaitlist === true) {
    return `${known} ${JOIN_WAITLIST_STEP}`;
  }
  if (known) return known;
  // An older age trigger raises a plain sentence with no code (20260902001922).
  if (/age requirement/i.test(errorText(err) ?? ""))
    return USER_ERROR_MESSAGES.AGE_REQUIREMENT_NOT_MET;
  return "Couldn't join this game. Please try again.";
}
