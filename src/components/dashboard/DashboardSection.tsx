import type { ReactNode } from "react";

// Matches the horizontal padding of `page-shell`, so a carousel can scroll to
// the screen edge while its first card still lines up with the page content.
const GUTTER = "clamp(0.75rem,4vw,2rem)";

/**
 * Titled block on the curated dashboard: an emoji + title, an optional badge
 * (urgency / counts) and an optional action on the right.
 */
export function DashboardSection({
  id,
  emoji,
  title,
  badge,
  action,
  children,
}: {
  id: string;
  emoji: string;
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="mb-7">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 id={headingId} className="font-display text-lg font-bold leading-tight">
            <span aria-hidden className="mr-1.5">
              {emoji}
            </span>
            {title}
          </h2>
          {badge}
        </div>
        {action && <div className="shrink-0 text-xs font-semibold">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Horizontal scroll-snap row that bleeds to the screen edges. */
export function DashboardCarousel({
  label,
  children,
}: {
  /** Names the scroller for assistive tech. */
  label: string;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide"
      style={{
        marginInline: `calc(${GUTTER} * -1)`,
        paddingInline: GUTTER,
        scrollPaddingInline: GUTTER,
      }}
    >
      {children}
    </ul>
  );
}

/** One carousel slot. Wide enough to read, narrow enough to hint at the next card. */
export function CarouselItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex w-[84%] max-w-[22rem] shrink-0 snap-start sm:w-[19rem]">{children}</li>
  );
}
