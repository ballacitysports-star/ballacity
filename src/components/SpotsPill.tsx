import type { ReactElement } from "react";

/**
 * Live "N spots" pill used by the Discover bottom card.
 *
 * `aria-atomic="true"` + `role="status"` so that assistive tech
 * re-announces the whole label when the count changes via the
 * `game_participants` realtime subscription.
 *
 * Politeness escalates when the game fills up:
 *   - spots remaining -> `aria-live="polite"` ("3 spots left").
 *     Announced without interrupting the user's current speech so
 *     count decrements don't spam the SR buffer.
 *   - zero spots      -> `aria-live="assertive"` ("Game is full —
 *     no spots remaining"). The user can no longer join, so we
 *     interrupt to give immediate feedback that further attempts
 *     will be blocked.
 *
 * `role="status"` is redundant with `aria-live` but improves
 * compatibility with older screen readers (JAWS < 2019, some NVDA
 * versions) that only pick up implicit live regions. We keep
 * `role="status"` even in the full state — `role="alert"` would
 * imply an error, and "no spots left" is expected app state, not
 * an error condition.
 */
export function SpotsPill({ spotsLeft }: { spotsLeft: number }): ReactElement {
  const isFull = spotsLeft <= 0;
  const label = isFull
    ? "Game is full — no spots remaining"
    : `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`;
  return (
    <span
      role="status"
      aria-live={isFull ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={label}
      className={
        isFull
          ? "rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-destructive-foreground"
          : "rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground"
      }
    >
      {isFull ? "Full" : `${spotsLeft} spots`}
    </span>
  );
}
