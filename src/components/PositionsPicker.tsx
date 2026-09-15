import { POSITIONS_BY_SPORT, type Sport } from "@/lib/sample-data";
import { Minus, Plus } from "lucide-react";

export type PositionsNeeded = Record<string, number>;

export function positionsCleanup(map: PositionsNeeded): PositionsNeeded {
  const out: PositionsNeeded = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (n > 0) out[k] = n;
  }
  return out;
}

export function PositionsPicker({
  sport,
  value,
  onChange,
}: {
  sport: Sport;
  value: PositionsNeeded;
  onChange: (next: PositionsNeeded) => void;
}) {
  const options = POSITIONS_BY_SPORT[sport] ?? [];
  const bump = (name: string, delta: number) => {
    const cur = value[name] ?? 0;
    const next = Math.max(0, Math.min(30, cur + delta));
    const nextMap = { ...value };
    if (next === 0) delete nextMap[name];
    else nextMap[name] = next;
    onChange(nextMap);
  };
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 space-y-2">
      {options.map((name) => {
        const count = value[name] ?? 0;
        const active = count > 0;
        return (
          <div
            key={name}
            className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
              active ? "border-lime/50 bg-lime/5" : "border-border bg-background"
            }`}
          >
            <span
              className={`text-sm font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}
            >
              {name}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => bump(name, -1)}
                disabled={count === 0}
                aria-label={`Remove one ${name}`}
                className="grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-muted-foreground disabled:opacity-40"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-6 text-center text-sm font-bold tabular-nums">{count}</span>
              <button
                type="button"
                onClick={() => bump(name, 1)}
                aria-label={`Add one ${name}`}
                className="grid h-7 w-7 place-items-center rounded-full bg-lime text-primary-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
      <p className="px-1 text-[11px] text-muted-foreground">
        Optional — tap + to list the spots you still need to fill.
      </p>
    </div>
  );
}

export function positionsSummary(map: PositionsNeeded, max = 3): string[] {
  const entries = Object.entries(map ?? {}).filter(([, v]) => v > 0);
  return entries.slice(0, max).map(([k, v]) => `${k} ×${v}`);
}

export function positionsTotal(map: PositionsNeeded): number {
  return Object.values(map ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}
