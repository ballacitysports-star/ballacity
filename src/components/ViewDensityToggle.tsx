import { List, Map as MapIcon, LayoutGrid, Rows3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ViewMode = "list" | "map";
export type Density = "grid" | "list";

const VIEW_ICONS: Record<ViewMode, LucideIcon> = { list: List, map: MapIcon };
const VIEW_LABELS: Record<ViewMode, string> = { list: "List", map: "Map" };

const DENSITY_META: Array<{ id: Density; label: string; Icon: LucideIcon }> = [
  { id: "grid", label: "Grid", Icon: LayoutGrid },
  { id: "list", label: "Compact", Icon: Rows3 },
];

export function ViewDensityToggle({
  view,
  onViewChange,
  density,
  onDensityChange,
  views = ["list", "map"],
  showDensity = true,
  variant = "full",
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  views?: ViewMode[];
  showDensity?: boolean;
  /**
   * "icons" folds view and density into one icon-only control (Grid, Compact,
   * Map) that fits on a header row. Needs the default list + map views.
   */
  variant?: "full" | "icons";
}) {
  if (variant === "icons") {
    const options = [
      { id: "grid", label: "Grid view", Icon: LayoutGrid },
      { id: "compact", label: "Compact view", Icon: Rows3 },
      { id: "map", label: "Map view", Icon: MapIcon },
    ] as const;
    const current = view === "map" ? "map" : density === "list" ? "compact" : "grid";
    const choose = (id: (typeof options)[number]["id"]) => {
      if (id === "map") return onViewChange("map");
      onViewChange("list");
      onDensityChange(id === "compact" ? "list" : "grid");
    };
    return (
      <div
        role="group"
        aria-label="Layout"
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
      >
        {options.map(({ id, label, Icon }) => {
          const active = current === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={active}
              onClick={() => choose(id)}
              className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                active ? "bg-lime text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-center gap-2">
      <div
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1"
        role="tablist"
        aria-label="View mode"
      >
        {views.map((id) => {
          const Icon = VIEW_ICONS[id];
          const active = view === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(id)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition-colors ${
                active ? "bg-lime text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {VIEW_LABELS[id]}
            </button>
          );
        })}
      </div>
      {showDensity && view === "list" && (
        <div
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1"
          role="tablist"
          aria-label="Card density"
        >
          {DENSITY_META.map(({ id, label, Icon }) => {
            const active = density === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                aria-label={`${label} view`}
                onClick={() => onDensityChange(id)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition-colors ${
                  active ? "bg-lime text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
