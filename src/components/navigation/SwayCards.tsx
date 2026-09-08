import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { COMMIT_VELOCITY, NO_SWIPE_ATTR } from "@/lib/navigation-gestures";

/**
 * A horizontally paged deck of cards with a slight sway: the card under the
 * finger stays upright and full size while its neighbours sit back, tilted and
 * scaled down, so the stack reads as depth rather than a flat filmstrip.
 *
 * Paging commits on either distance or a flick, matching the thresholds the
 * page-level swipe uses, so both gestures feel like the same surface.
 *
 * The deck marks itself as opted out of page navigation: without that, a drag
 * across a card would also page the tab underneath it.
 */

/** How far a neighbour tilts, in degrees. */
const SWAY_DEGREES = 6;
/** How far a neighbour shrinks. */
const SWAY_SCALE = 0.9;
/** Fraction of the card that must be dragged to page on distance alone. */
const PAGE_DISTANCE_RATIO = 0.35;

const SETTLE = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.8 };

export type SwayCardsProps = {
  children: React.ReactNode[];
  /** Names the deck for assistive tech, e.g. "Featured games". */
  label: string;
  /** Index to open on. Uncontrolled after mount. */
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  className?: string;
};

export function SwayCards({
  children,
  label,
  initialIndex = 0,
  onIndexChange,
  className,
}: SwayCardsProps) {
  const cards = children.filter(Boolean);
  const count = cards.length;
  const reducedMotion = useReducedMotion();
  const baseId = useId();

  const [index, setIndex] = useState(() => clamp(initialIndex, 0, Math.max(0, count - 1)));
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Measure the card so paging maths works at any breakpoint.
  useEffect(() => {
    const node = trackRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A shrinking list must not strand the view past the end.
  useEffect(() => {
    setIndex((current) => clamp(current, 0, Math.max(0, count - 1)));
  }, [count]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = clamp(next, 0, Math.max(0, count - 1));
      setIndex((current) => {
        if (current !== clamped) onIndexChange?.(clamped);
        return clamped;
      });
    },
    [count, onIndexChange],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      }
    },
    [goTo, index],
  );

  if (count === 0) return null;

  const offset = -index * width + drag;

  return (
    <div
      className={className}
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      {...{ [NO_SWIPE_ATTR]: "" }}
    >
      <div ref={trackRef} className="relative overflow-hidden">
        <motion.div
          className="flex cursor-grab active:cursor-grabbing"
          drag={reducedMotion ? false : "x"}
          dragElastic={0.12}
          dragMomentum={false}
          // Constrained to the deck's own span so the track cannot be flung
          // off past the first or last card.
          dragConstraints={{ left: -(count - 1) * width, right: 0 }}
          onDrag={(_, info) => setDrag(info.offset.x)}
          onDragEnd={(_, info) => {
            setDrag(0);
            const travelled = info.offset.x;
            const flicked = Math.abs(info.velocity.x) / 1000 > COMMIT_VELOCITY;
            const far = width > 0 && Math.abs(travelled) > width * PAGE_DISTANCE_RATIO;
            if (!flicked && !far) return;
            goTo(index + (travelled < 0 ? 1 : -1));
          }}
          animate={{ x: offset }}
          transition={drag !== 0 ? { duration: 0 } : SETTLE}
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-live="polite"
        >
          {cards.map((card, i) => {
            const distance = i - index;
            const isActive = distance === 0;
            return (
              <motion.div
                key={i}
                className="w-full shrink-0 px-1"
                animate={
                  reducedMotion
                    ? undefined
                    : {
                        scale: isActive ? 1 : SWAY_SCALE,
                        rotate: isActive ? 0 : distance > 0 ? SWAY_DEGREES : -SWAY_DEGREES,
                        opacity: Math.abs(distance) > 1 ? 0.4 : 1,
                      }
                }
                transition={SETTLE}
                style={{ transformOrigin: distance > 0 ? "left center" : "right center" }}
                aria-hidden={!isActive}
                // Off-screen cards keep their content out of the tab order.
                {...(isActive ? {} : { inert: "" as unknown as boolean })}
              >
                {card}
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {count > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to item ${i + 1} of ${count}`}
              aria-current={i === index}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/40"
              }`}
              id={`${baseId}-dot-${i}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
