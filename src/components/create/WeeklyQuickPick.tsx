import { Check } from "lucide-react";

type Slot = {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start: string;
  end: string;
  venue?: string;
};

type Preset = {
  id: string;
  label: string;
  hint: string;
  slots: Slot[];
};

const PRESETS: Preset[] = [
  {
    id: "weekday-evenings",
    label: "Weekday evenings",
    hint: "Mon–Fri, 5–8pm",
    slots: (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({
      day,
      start: "17:00",
      end: "20:00",
    })),
  },
  {
    id: "weekend-mornings",
    label: "Weekend mornings",
    hint: "Sat & Sun, 8am–12pm",
    slots: [
      { day: "sat", start: "08:00", end: "12:00" },
      { day: "sun", start: "08:00", end: "12:00" },
    ],
  },
  {
    id: "early-birds",
    label: "Early mornings",
    hint: "Mon–Fri, 6–9am",
    slots: (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({
      day,
      start: "06:00",
      end: "09:00",
    })),
  },
  {
    id: "full-week",
    label: "Full week",
    hint: "Every day, 9am–6pm",
    slots: (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => ({
      day,
      start: "09:00",
      end: "18:00",
    })),
  },
];

export function WeeklyQuickPick({
  value,
  onChange,
}: {
  value: Slot[];
  onChange: (slots: Slot[]) => void;
}) {
  function isActive(preset: Preset) {
    if (value.length !== preset.slots.length) return false;
    return preset.slots.every((s) =>
      value.some((v) => v.day === s.day && v.start === s.start && v.end === s.end),
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Pick a starting weekly template — you can fine-tune later from your profile.
      </p>
      <div className="grid gap-2">
        {PRESETS.map((p) => {
          const active = isActive(p);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(active ? [] : p.slots)}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                active ? "border-lime bg-lime/10" : "border-border bg-surface hover:border-lime/40"
              }`}
            >
              <div>
                <div className={`text-sm font-bold ${active ? "text-lime" : ""}`}>{p.label}</div>
                <div className="text-[11px] text-muted-foreground">{p.hint}</div>
              </div>
              {active && <Check className="h-4 w-4 text-lime" />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange([])}
          className={`rounded-2xl border border-dashed px-4 py-3 text-left transition-colors ${
            value.length === 0
              ? "border-border/60 bg-surface/50 text-muted-foreground"
              : "border-border bg-surface hover:border-coral/40"
          }`}
        >
          <div className="text-sm font-bold">Skip for now</div>
          <div className="text-[11px] text-muted-foreground">
            Set specific windows and dates from your profile later.
          </div>
        </button>
      </div>
    </div>
  );
}
