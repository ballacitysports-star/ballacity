import { DIRECTORY_FILTERS, type DirectoryFilterId } from "@/lib/org-directory-filters";

/**
 * Quick filters for the gyms directory: one tap, no sheet. Same chip shape as
 * the sport pickers (44px tap floor, filled + aria-pressed when on) and a
 * sideways-scrolling row on narrow screens.
 */
export function OrgFilterPills({
  selected,
  onToggle,
  onClear,
}: {
  selected: ReadonlySet<DirectoryFilterId>;
  onToggle: (id: DirectoryFilterId) => void;
  onClear: () => void;
}) {
  const chip =
    "shrink-0 snap-start inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors";
  const on = "border-lime bg-lime text-primary-foreground";
  const off = "border-border bg-surface text-muted-foreground hover:text-foreground";
  const none = selected.size === 0;

  return (
    <div
      role="group"
      aria-label="Filter facilities"
      className="flex snap-x gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1"
    >
      <button
        type="button"
        onClick={onClear}
        aria-pressed={none}
        className={`${chip} ${none ? on : off}`}
      >
        All
      </button>
      {DIRECTORY_FILTERS.map((f) => {
        const active = selected.has(f.id);
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onToggle(f.id)}
            aria-pressed={active}
            className={`${chip} ${active ? on : off}`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
