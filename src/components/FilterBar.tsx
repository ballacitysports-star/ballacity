import { Link } from "@tanstack/react-router";
import { Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { FilterSheet } from "@/components/FilterSheet";

/**
 * Unified filter bar used across Players, Teams, Trainers, and Feed.
 *
 * Renders a sticky-friendly row of:
 *   [ search input ] [ Filters button (badge) ] [ optional Create ]
 *
 * The Filters button opens a shared bottom sheet whose contents are
 * provided by the caller via `sheet`. Each tab keeps ownership of its
 * URL-persisted state and passes concrete controls into the sheet.
 */
export type FilterBarCreate = {
  to: string;
  label: string;
};

export function FilterBar({
  q,
  onQChange,
  searchPlaceholder = "Search",
  activeFilterCount = 0,
  create,
  chips,
  sheetTitle,
  sheet,
  onReset,
  resetDisabled,
  rightExtra,
}: {
  q: string;
  onQChange: (v: string) => void;
  searchPlaceholder?: string;
  activeFilterCount?: number;
  create?: FilterBarCreate;
  /** Optional chip row rendered under the search — e.g. shared SportChips */
  chips?: React.ReactNode;
  sheetTitle?: string;
  sheet: React.ReactNode;
  onReset?: () => void;
  resetDisabled?: boolean;
  /** Optional slot rendered before the Create button (e.g. mode toggle) */
  rightExtra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button onClick={() => onQChange("")} aria-label="Clear search">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        {rightExtra}
        <button
          onClick={() => setOpen(true)}
          className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full border bg-surface ${
            activeFilterCount ? "border-lime" : "border-border"
          }`}
          aria-label="Filters"
          aria-expanded={open}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
        {create && (
          <Link
            to={create.to}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
            aria-label={create.label}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </Link>
        )}
      </div>
      {chips && <div className="mt-3">{chips}</div>}
      <FilterSheet
        open={open}
        onClose={() => setOpen(false)}
        title={sheetTitle ?? "Filters"}
        onReset={onReset}
        resetDisabled={resetDisabled}
      >
        {sheet}
      </FilterSheet>
    </div>
  );
}
