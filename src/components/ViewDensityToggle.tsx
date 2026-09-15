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
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  views?: ViewMode[];
  showDensity?: boolean;
}) {
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
