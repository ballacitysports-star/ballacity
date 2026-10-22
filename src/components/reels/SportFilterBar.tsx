import { useEffect, useRef } from "react";
import { sampleImageForSport } from "@/lib/sample-data";

/**
 * One row of sport chips for the Reels feed: "All", then a chip per sport, each
 * with a small picture so a sport can be spotted without reading. It scrolls
 * sideways (the chosen chip is brought into view), fades at the right edge to
 * show there is more, and every chip is a 44px-high button that says whether it
 * is pressed.
 */
export function SportFilterBar({
  sports,
  selected,
  onSelect,
}: {
  sports: string[];
  selected: string | null;
  onSelect: (sport: string | null) => void;
}) {
  const active = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Keep the chosen chip in view when it was picked from a link or the URL.
    active.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [selected]);

  return (
    <div role="group" aria-label="Filter reels by sport" className="relative">
      <ul className="flex snap-x gap-2 overflow-x-auto px-4 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip label="All sports" pressed={selected === null} onClick={() => onSelect(null)} />
        {sports.map((s) => (
          <Chip
            key={s}
            label={s}
            sport={s}
            pressed={selected?.toLowerCase() === s.toLowerCase()}
            onClick={() => onSelect(s)}
            buttonRef={selected?.toLowerCase() === s.toLowerCase() ? active : undefined}
          />
        ))}
      </ul>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
      />
    </div>
  );
}

function Chip({
  label,
  sport,
  pressed,
  onClick,
  buttonRef,
}: {
  label: string;
  sport?: string;
  pressed: boolean;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <li className="snap-start">
      <button
        ref={buttonRef}
        type="button"
        aria-pressed={pressed}
        onClick={onClick}
        className={`inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border py-1 pl-1.5 pr-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          pressed
            ? "border-lime bg-lime/15 text-lime"
            : "border-border bg-surface text-muted-foreground hover:border-lime/40"
        }`}
      >
        {sport ? (
          <img
            src={sampleImageForSport(sport)}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-black"
          >
            All
          </span>
        )}
        {label}
      </button>
    </li>
  );
}
