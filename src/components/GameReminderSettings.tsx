import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { REMINDER_PRESETS, formatDuration } from "@/lib/datetime";
import {
  DEFAULT_GAME_REMINDER_OFFSETS,
  getMyGameReminderOffsets,
  saveMyGameReminderOffsets,
} from "@/lib/game-reminders";

function Chips({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  const toggle = (min: number) => {
    const set = new Set(value);
    if (set.has(min)) set.delete(min);
    else set.add(min);
    onChange([...set].sort((a, b) => b - a));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {REMINDER_PRESETS.map((p) => {
        const active = value.includes(p.min);
        return (
          <button
            type="button"
            key={p.min}
            onClick={() => toggle(p.min)}
            aria-pressed={active}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              active
                ? "border-lime bg-lime/10 text-lime"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/** Reminder picker used inside the RSVP / join confirmation dialog. */
export function GameReminderPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="space-y-1.5 text-left">
      <div className="flex items-center gap-1.5 section-eyebrow text-muted-foreground">
        <BellRing className="size-3.5 text-lime" /> Remind me before it starts
      </div>
      <Chips value={value} onChange={onChange} />
      <p className="text-[11px] text-muted-foreground">
        {value.length
          ? `We'll notify you ${value.map((m) => `${formatDuration(m)} before`).join(" and ")}.`
          : "No reminders — you can add them later on this page."}
      </p>
    </div>
  );
}

/** Self-saving reminder card shown to players already on the roster. */
export function GameReminderCard({ gameId }: { gameId: string }) {
  const [value, setValue] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const saved = await getMyGameReminderOffsets(gameId);
      if (cancel) return;
      setValue(saved ?? [...DEFAULT_GAME_REMINDER_OFFSETS]);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [gameId]);

  const update = async (next: number[]) => {
    setValue(next);
    const ok = await saveMyGameReminderOffsets(gameId, next);
    if (!ok) toast.error("Couldn't save your reminders.");
  };

  if (loading) return null;

  return (
    <div className="rounded-3xl border border-border bg-surface p-4 space-y-2">
      <div className="flex items-center gap-2">
        <BellRing className="size-4 text-lime" />
        <h3 className="font-display text-sm font-bold">Your reminders</h3>
      </div>
      <Chips value={value} onChange={update} />
      <p className="text-[11px] text-muted-foreground">
        {value.length
          ? `You'll get a notification ${value.map((m) => `${formatDuration(m)} before`).join(" and ")} start.`
          : "Reminders off for this game."}
      </p>
    </div>
  );
}
