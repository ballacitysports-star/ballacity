import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin, Globe } from "lucide-react";
import type { Slot } from "@/lib/availability-slots";
import {
  type AvailabilityRule,
  type DayOverride,
  fromDateKey,
  maxHorizonDate,
  resolveDay,
  toDateKey,
} from "@/lib/availability-resolve";
import { DEFAULT_TZ, fmt12, getBrowserTz, tzRelativeLabel, tzShortName } from "@/lib/tz";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function TrainerAvailabilityMonth({
  weekly,
  overrides,
  rules,
  primaryVenue,
  venueFilter,
  trainerTz,
}: {
  weekly: Slot[];
  overrides: DayOverride[];
  rules?: AvailabilityRule[];
  primaryVenue?: string | null;
  venueFilter?: string | null;
  /** Trainer's IANA timezone. Availability windows are stored in this tz. */
  trainerTz?: string | null;
}) {
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const horizon = useMemo(() => maxHorizonDate(today), [today]);
  const [cursor, setCursor] = useState<Date>(startOfMonth(today));
  const [selected, setSelected] = useState<string>(toDateKey(today));

  const viewerTz = useMemo(() => getBrowserTz(), []);
  const tTz = trainerTz || DEFAULT_TZ;
  const differ = tTz !== viewerTz;
  const [showInTrainerTz, setShowInTrainerTz] = useState(false);
  const activeViewerTz = showInTrainerTz ? tTz : viewerTz;
  const resolverOpts = useMemo(
    () => ({ venueFilter, trainerTz: tTz, viewerTz: activeViewerTz, rules: rules ?? [] }),
    [venueFilter, tTz, activeViewerTz, rules],
  );

  const monthStart = startOfMonth(cursor);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  const canGoBack = monthStart > startOfMonth(today);
  const canGoNext = monthStart < startOfMonth(horizon);

  const selectedResolved = useMemo(
    () => resolveDay(fromDateKey(selected), weekly, overrides, resolverOpts),
    [selected, weekly, overrides, resolverOpts],
  );
  const selectedOverride = overrides.find((o) => o.date === selected);
  const tzLabel = tzShortName(fromDateKey(selected), activeViewerTz);
  const rel = differ ? tzRelativeLabel(tTz, viewerTz) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => canGoBack && setCursor(addMonths(cursor, -1))}
          disabled={!canGoBack}
          className="rounded-full p-1.5 text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-bold">
          {cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </div>
        <button
          type="button"
          onClick={() => canGoNext && setCursor(addMonths(cursor, 1))}
          disabled={!canGoNext}
          className="rounded-full p-1.5 text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {differ && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface/60 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-lime" />
            Showing in{" "}
            <span className="font-semibold text-foreground">
              {showInTrainerTz ? "trainer's" : "your"} time
            </span>
            {rel && !showInTrainerTz && (
              <span className="text-muted-foreground">· trainer is {rel}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setShowInTrainerTz((v) => !v)}
            className="rounded-full border border-border bg-background px-2.5 py-1 font-semibold text-foreground hover:border-lime/60"
          >
            {showInTrainerTz ? "Show my time" : "Show trainer's time"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 px-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {DAY_LABELS.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const key = toDateKey(d);
          const inMonth = isSameMonth(d, monthStart);
          const past = d < today;
          const beyond = d > horizon;
          const disabled = past || beyond;
          const override = overrides.find((o) => o.date === key);
          const closed = override?.closed;
          const hasAny = !disabled && resolveDay(d, weekly, overrides, resolverOpts).length > 0;
          const isSelected = key === selected;
          const state = disabled
            ? "border-border/30 bg-transparent text-muted-foreground/40 cursor-not-allowed"
            : closed
              ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
              : hasAny
                ? "border-lime/50 bg-lime/10 text-foreground hover:border-lime"
                : "border-border bg-surface text-muted-foreground hover:border-lime/40";
          return (
            <button
              type="button"
              key={key}
              disabled={disabled}
              onClick={() => setSelected(key)}
              className={`relative aspect-square rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-0.5 transition-all ${state} ${!inMonth ? "opacity-40" : ""} ${isSelected ? "ring-2 ring-lime" : ""}`}
            >
              <span>{d.getDate()}</span>
              {!disabled && hasAny && !closed && <span className="h-1 w-1 rounded-full bg-lime" />}
              {!disabled && closed && <span className="text-[8px] font-bold uppercase">×</span>}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-bold">
            {fromDateKey(selected).toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {tzLabel}
            </span>
            {selectedOverride?.closed ? (
              <span className="rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                Closed
              </span>
            ) : selectedOverride ? (
              <span className="rounded-full border border-lime/50 bg-lime/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-lime">
                Custom
              </span>
            ) : null}
          </div>
        </div>
        {selectedResolved.length === 0 ? (
          <p className="text-xs text-muted-foreground">No availability on this day.</p>
        ) : (
          <ul className="space-y-1.5">
            {selectedResolved.map((r, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm"
              >
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {fmt12(r.start)} – {fmt12(r.end === "24:00" ? "23:59" : r.end)}
                    {r.crossesDay && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                        (spans day)
                      </span>
                    )}
                  </span>
                  {differ && r.trainerStart && r.trainerEnd && !showInTrainerTz && (
                    <span className="text-[10px] text-muted-foreground">
                      Trainer: {fmt12(r.trainerStart)} – {fmt12(r.trainerEnd)}{" "}
                      {tzShortName(fromDateKey(selected), tTz)}
                    </span>
                  )}
                </span>
                {r.venue ? (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MapPin className="h-3 w-3 text-coral" />
                    {primaryVenue?.trim() === r.venue.trim() ? "★ " : ""}
                    {r.venue}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Any venue</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
