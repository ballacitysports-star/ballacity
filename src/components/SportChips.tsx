import { SPORTS } from "@/lib/sample-data";
import { motion } from "framer-motion";

export function SportChips({
  selected,
  onSelect,
}: {
  /** Single sport, list of sports (multi-select), or null/empty for "All". */
  selected?: string | string[] | null;
  onSelect?: (sport: string | null) => void;
}) {
  const selectedList = Array.isArray(selected)
    ? selected
    : selected
      ? [selected]
      : [];
  const selectedSet = new Set(selectedList);
  const noneSelected = selectedSet.size === 0;
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
      <button
        onClick={() => onSelect?.(null)}
        className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
          noneSelected
            ? "border-lime bg-lime text-primary-foreground"
            : "border-border bg-surface text-muted-foreground hover:text-foreground"
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
            onClick={() => onSelect?.(active ? null : s.name)}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
              active
                ? "border-lime bg-lime text-primary-foreground"
                : "border-border bg-surface text-foreground hover:border-lime/40"
            }`}
          >
            <span>{s.emoji}</span>
            <span>{s.name}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
