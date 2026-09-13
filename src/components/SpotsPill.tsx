import type { ReactElement } from "react";
import { getSpotsUrgency } from "@/lib/spots-urgency";

/**
 * Live "N spots" pill shared by the Discover bottom card, feed/game cards,
 * and the game-detail roster header.
 *
 * `aria-atomic="true"` + `role="status"` so that assistive tech
 * re-announces the whole label when the count changes via the
 * `game_participants` realtime subscription.
 *
 * Politeness escalates as availability shrinks:
 *   - normal / low       -> `aria-live="polite"` ("12 spots left").
 *     Announced without interrupting the user's current speech so
 *     count decrements don't spam the SR buffer.
 *   - critical (1–3)     -> `aria-live="assertive"` ("Only 2 spots left —
 *     filling fast"). Users need to act fast if they still want in.
 *   - full (0)           -> `aria-live="assertive"` ("Game is full —
 *     no spots remaining"). The user can no longer join, so we
 *     interrupt to give immediate feedback.
 *
 * `role="status"` is redundant with `aria-live` but improves compatibility
 * with older screen readers (JAWS < 2019, some NVDA versions) that only
 * pick up implicit live regions. We keep `role="status"` even in the full
 * / critical states — `role="alert"` would imply an error, and "filling
 * fast" is expected app state, not an error condition.
 *
 * `maxPlayers` is optional; when supplied, the amber `low` bucket
 * (≤20% of capacity, >3 spots) activates.
 */
export function SpotsPill({
  spotsLeft,
  maxPlayers,
}: {
  spotsLeft: number;
  maxPlayers?: number;
}): ReactElement {
  const urgency = getSpotsUrgency(spotsLeft, maxPlayers);
  const isFull = urgency === "full";
  const isCritical = urgency === "critical";
  const label = isFull
    ? "Game is full — no spots remaining"
    : isCritical
      ? `Only ${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left — filling fast`
      : `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`;
  const cls =
    urgency === "full"
      ? "rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-destructive-foreground"
      : urgency === "critical"
        ? "rounded-full bg-coral px-2.5 py-0.5 text-[11px] font-bold text-white motion-safe:animate-pulse"
        : urgency === "low"
          ? "rounded-full bg-amber-500/90 px-2.5 py-0.5 text-[11px] font-bold text-white"
          : "rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground";
  const visible = isFull ? "Full" : `${spotsLeft} spots`;
  return (
    <span
      role="status"
      aria-live={isFull ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={label}
      className={cls}
    >
      {/* key={spotsLeft} remounts the inner span on every count change so
          the scale-in keyframe replays — a subtle bump that draws the eye
          to availability updates without being distracting. */}
      <span key={spotsLeft} className="inline-block motion-safe:animate-scale-in">
        {visible}
      </span>
    </span>
  );
}
