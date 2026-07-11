import type { ReactElement } from "react";

/**
 * Live "N spots" pill used by the Discover bottom card.
 *
 * `aria-live="polite"` + `aria-atomic="true"` + `role="status"` so that
 * assistive tech re-announces the whole label ("3 spots left") when the
 * count changes via the `game_participants` realtime subscription,
 * without interrupting the user's current speech.
 *
 * `role="status"` is redundant with `aria-live="polite"` but improves
 * compatibility with older screen readers (JAWS < 2019, some NVDA
 * versions) that only pick up implicit live regions.
 */
export function SpotsPill({ spotsLeft }: { spotsLeft: number }): ReactElement {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`}
      className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground"
    >
      {spotsLeft} spots
    </span>
  );
}
