import { SPORTS } from "@/lib/sample-data";
import { motion } from "framer-motion";

export function SportChips({
  selected,
  onSelect,
  multi = false,
}: {
  /** Single sport, list of sports (multi-select), or null/empty for "All". */
  selected?: string | string[] | null;
  /**
   * Called with the tapped sport, or null for "All sports".
   * In single mode tapping the active chip clears it (null); in multi mode the
   * sport is always passed through so the caller can toggle it in/out.
   */
  onSelect?: (sport: string | null) => void;
  /** Chips toggle sports in and out of a multi-sport selection. */
  multi?: boolean;
}) {
  const selectedList = Array.isArray(selected)
    ? selected
    : selected
      ? [selected]
      : [];
  const selectedSet = new Set(selectedList);
  const noneSelected = selectedSet.size === 0;

  // One chip shape for every chip: a 44px tap floor, the same padding, and the
  // same active treatment (filled + aria-pressed) so the selected sport is not
  // signalled by colour alone. `snap-x` keeps a chip from being left half cut
  // off at the edge of the scroller on a phone.
  const chip =
    "shrink-0 snap-start inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors";
  const on = "border-lime bg-lime text-primary-foreground";

  return (
    <div
      role="group"
      aria-label="Filter by sport"
      className="flex snap-x gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1"
    >
      <button
        onClick={() => onSelect?.(null)}
        aria-pressed={noneSelected}
        className={`${chip} ${
          noneSelected ? on : "border-border bg-surface text-muted-foreground hover:text-foreground"
        }`}
      >
        All sports
      </button>
      {SPORTS.map((s, i) => {
        const active = selectedSet.has(s.name);
        return (
          <motion.button
            key={s.name}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => onSelect?.(multi ? s.name : active ? null : s.name)}
            aria-pressed={active}
            className={`${chip} ${
              active ? on : "border-border bg-surface text-foreground hover:border-lime/40"
            }`}
          >
            <span aria-hidden>{s.emoji}</span>
            <span>{s.name}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
