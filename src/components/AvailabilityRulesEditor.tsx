import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Repeat } from "lucide-react";
import type { AvailabilityRule, Weekday } from "@/lib/availability-resolve";
import { toDateKey, maxHorizonDate } from "@/lib/availability-resolve";
import { validateRules } from "@/lib/availability-slots";

type Props = {
  value: AvailabilityRule[];
  onChange: (rules: AvailabilityRule[]) => void;
  venues?: string[];
};

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const ALL_WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEK_OF_MONTH_OPTS: (1 | 2 | 3 | 4 | "last")[] = [1, 2, 3, 4, "last"];

function newRule(): AvailabilityRule {
  const today = toDateKey(new Date());
  return {
    id: crypto.randomUUID().slice(0, 8),
    label: "",
    weekdays: ["tue", "thu"],
    start: "17:00",
    end: "19:00",
    freq: "weekly",
    interval: 1,
    anchorDate: today,
  };
}

function ruleSummary(r: AvailabilityRule): string {
  const days = r.weekdays.map((d) => WEEKDAY_LABEL[d]).join(", ");
  if (r.freq === "weekly") {
    const n = Math.max(1, r.interval ?? 1);
    return n === 1 ? `Every ${days}` : `Every ${n} weeks on ${days}`;
  }
  if (r.freq === "biweekly") return `Every other ${days}`;
  const weeks = (r.weekOfMonth ?? [])
    .map((w) => (w === "last" ? "Last" : `${w}${["st", "nd", "rd"][w - 1] ?? "th"}`))
    .join(", ");
  return `${weeks || "—"} ${days} of month`;
}

export function AvailabilityRulesEditor({ value, onChange, venues = [] }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const error = useMemo(
    () => validateRules(value, new Set(venues.map((v) => v.trim().toLowerCase()))),
    [value, venues],
  );
  const horizon = useMemo(() => toDateKey(maxHorizonDate(new Date())), []);
  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const update = (id: string, patch: Partial<AvailabilityRule>) => {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const remove = (id: string) => onChange(value.filter((r) => r.id !== id));
  const add = () => {
    const r = newRule();
    onChange([...value, r]);
    setExpandedId(r.id);
  };

  const toggleWeekday = (r: AvailabilityRule, d: Weekday) => {
    const next = r.weekdays.includes(d) ? r.weekdays.filter((x) => x !== d) : [...r.weekdays, d];
    update(r.id, { weekdays: next as Weekday[] });
  };

  const toggleWeekOfMonth = (r: AvailabilityRule, w: 1 | 2 | 3 | 4 | "last") => {
    const cur = r.weekOfMonth ?? [];
    const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w];
    update(r.id, { weekOfMonth: next });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Recurring rules auto-populate the calendar up to 6 months out.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
        </Button>
      </div>

      {value.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-surface/50 p-4 text-sm text-muted-foreground text-center">
          No recurring rules yet. Add one for patterns like "Every Tue/Thu 5–7pm" or "1st & 3rd
          Monday".
        </div>
      )}

      {value.map((r) => {
        const open = expandedId === r.id;
        return (
          <div key={r.id} className="rounded-2xl border border-border bg-surface">
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 text-left"
              onClick={() => setExpandedId(open ? null : r.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {r.label?.trim() || ruleSummary(r)}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.start}–{r.end}
                  {r.venue ? ` · ${r.venue}` : ""}
                </div>
              </div>
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {r.freq === "monthly-nth"
                  ? "Monthly"
                  : r.freq === "biweekly"
                    ? "Bi-weekly"
                    : "Weekly"}
              </Badge>
            </button>

            {open && (
              <div className="border-t border-border p-3 space-y-3">
                <div className="grid gap-2">
                  <Label className="text-xs">Label (optional)</Label>
                  <Input
                    placeholder="e.g. Youth clinic"
                    value={r.label ?? ""}
                    onChange={(e) => update(r.id, { label: e.target.value })}
                    maxLength={120}
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs">Recurrence</Label>
                  <Select
                    value={r.freq}
                    onValueChange={(v) => update(r.id, { freq: v as AvailabilityRule["freq"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly (every other week)</SelectItem>
                      <SelectItem value="monthly-nth">Monthly — specific weeks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {r.freq === "weekly" && (
                  <div className="grid gap-2">
                    <Label className="text-xs">Interval (weeks)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={r.interval ?? 1}
                      onChange={(e) =>
                        update(r.id, {
                          interval: Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                )}

                <div className="grid gap-2">
                  <Label className="text-xs">Weekdays</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_WEEKDAYS.map((d) => {
                      const active = r.weekdays.includes(d);
                      return (
                        <button
                          type="button"
                          key={d}
                          onClick={() => toggleWeekday(r, d)}
                          className={`px-2.5 py-1 rounded-full text-xs border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border"}`}
                        >
                          {WEEKDAY_LABEL[d]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {r.freq === "monthly-nth" && (
                  <div className="grid gap-2">
                    <Label className="text-xs">Week of month</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEK_OF_MONTH_OPTS.map((w) => {
                        const active = (r.weekOfMonth ?? []).includes(w);
                        return (
                          <button
                            type="button"
                            key={String(w)}
                            onClick={() => toggleWeekOfMonth(r, w)}
                            className={`px-2.5 py-1 rounded-full text-xs border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border"}`}
                          >
                            {w === "last" ? "Last" : `${w}${["st", "nd", "rd"][w - 1] ?? "th"}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Start</Label>
                    <Input
                      type="time"
                      value={r.start}
                      onChange={(e) => update(r.id, { start: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">End</Label>
                    <Input
                      type="time"
                      value={r.end}
                      onChange={(e) => update(r.id, { end: e.target.value })}
                    />
                  </div>
                </div>

                {venues.length > 0 && (
                  <div className="grid gap-2">
                    <Label className="text-xs">Venue</Label>
                    <Select
                      value={r.venue ?? "__none"}
                      onValueChange={(v) => update(r.id, { venue: v === "__none" ? undefined : v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Any venue" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Any venue</SelectItem>
                        {venues.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Starts on</Label>
                    <Input
                      type="date"
                      min={todayKey}
                      max={horizon}
                      value={r.anchorDate}
                      onChange={(e) => update(r.id, { anchorDate: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Ends on (optional)</Label>
                    <Input
                      type="date"
                      min={r.anchorDate}
                      max={horizon}
                      value={r.until ?? ""}
                      onChange={(e) => update(r.id, { until: e.target.value || undefined })}
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(r.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove rule
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <p className="text-xs text-destructive">
          Rule {error.index + 1}: {error.message}
        </p>
      )}
    </div>
  );
}
