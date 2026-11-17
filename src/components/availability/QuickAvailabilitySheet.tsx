import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createAvailability } from "@/lib/availability";
import {
  AVAILABILITY_INTENTS,
  INTENT_LABEL,
  type AvailabilityIntent,
} from "@/lib/availability-levels";
import { availabilityGateMessage, useAvailabilityGate } from "@/lib/availability-gate";
import { TIME_PRESETS, WEEKDAY_LABELS, fromDateKey, toDateKey } from "@/lib/availability-timeslots";
import {
  buildQuickPost,
  quickDateKey,
  quickDefaults,
  type QuickChoice,
  type QuickProfile,
} from "@/lib/quick-availability";
import { useMyProfile } from "@/lib/user-prefs-store";

type QuickProfileSport = QuickProfile["sports"][number];

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${
        selected
          ? "border-lime bg-lime text-primary-foreground"
          : "border-border bg-surface text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * "I'm available" in three taps: day, time of day, post. Sport, level and city come from the profile; "More options"
 * opens the full form for several days, a note or a travel radius.
 */
export function QuickAvailabilitySheet({
  open,
  onOpenChange,
  onPosted,
  onMoreOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted: () => void;
  onMoreOptions?: () => void;
}) {
  const profile = useMyProfile();
  const gate = useAvailabilityGate();
  // Keyed on the profile's content, not its identity: a store that hands back a new object on every render must not
  // reset the sheet (or loop).
  const profileKey = JSON.stringify(
    profile ? { sports: profile.sports ?? [], city: profile.city ?? null } : null,
  );
  const quickProfile = useMemo(
    () => JSON.parse(profileKey) as { sports: QuickProfileSport[]; city: string | null } | null,
    [profileKey],
  );
  const [choice, setChoice] = useState<QuickChoice>(() => quickDefaults(quickProfile));
  const [saving, setSaving] = useState(false);

  // Fresh defaults every time the sheet opens (the profile may have loaded since).
  useEffect(() => {
    if (open) setChoice(quickDefaults(quickProfile));
  }, [open, quickProfile]);

  const set = (patch: Partial<QuickChoice>) => setChoice((c) => ({ ...c, ...patch }));
  const sports = quickProfile?.sports.map((s) => s.name).filter(Boolean) ?? [];
  const sportOptions = sports.length ? sports : ["Basketball"];
  const dateKey = quickDateKey(choice.day);
  const weekdayLabel = WEEKDAY_LABELS[fromDateKey(dateKey).getDay()];
  const todayKey = toDateKey(new Date());

  const post = async () => {
    if (!gate.loading && !gate.canPost) {
      toast.error(availabilityGateMessage(gate.reason));
      return;
    }
    const built = buildQuickPost(choice, quickProfile);
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    setSaving(true);
    try {
      await createAvailability(built.payload);
      onPosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post your availability. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleIntent = (i: AvailabilityIntent) =>
    set({
      intents: choice.intents.includes(i)
        ? choice.intents.filter((x) => x !== i)
        : [...choice.intents, i],
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl pb-8">
        <SheetHeader className="text-left">
          <SheetTitle>I'm available</SheetTitle>
          <SheetDescription>
            Players and hosts near you will see when you can play.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {sportOptions.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-xs font-bold uppercase text-muted-foreground">
                Sport
              </legend>
              <div className="flex flex-wrap gap-2">
                {sportOptions.map((s) => (
                  <Chip key={s} selected={choice.sport === s} onClick={() => set({ sport: s })}>
                    {s}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase text-muted-foreground">When</legend>
            <div className="flex flex-wrap gap-2">
              <Chip selected={choice.day === "today"} onClick={() => set({ day: "today" })}>
                Today
              </Chip>
              <Chip selected={choice.day === "tomorrow"} onClick={() => set({ day: "tomorrow" })}>
                Tomorrow
              </Chip>
              <label
                className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-bold ${
                  typeof choice.day === "object"
                    ? "border-lime bg-lime/10 text-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                <span>Pick a day</span>
                <Input
                  type="date"
                  aria-label="Pick a day"
                  min={todayKey}
                  value={typeof choice.day === "object" ? choice.day.date : ""}
                  onChange={(e) => e.target.value && set({ day: { date: e.target.value } })}
                  className="h-8 w-auto border-0 bg-transparent px-1 text-sm"
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase text-muted-foreground">Time</legend>
            <div className="flex flex-wrap gap-2">
              {TIME_PRESETS.map((p) => (
                <Chip
                  key={p.id}
                  selected={choice.timeId === p.id}
                  onClick={() => set({ timeId: p.id })}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <label className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4">
            <span className="text-sm font-semibold">Every {weekdayLabel}</span>
            <Switch
              checked={choice.weekly}
              onCheckedChange={(v) => set({ weekly: v })}
              aria-label={`Repeat every ${weekdayLabel}`}
            />
          </label>
          {choice.weekly && (
            <p className="-mt-3 text-xs text-muted-foreground">
              We'll check in every two weeks so your post stays current.
            </p>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase text-muted-foreground">
              Up for
            </legend>
            <div className="flex flex-wrap gap-2">
              {AVAILABILITY_INTENTS.map((i) => (
                <Chip key={i} selected={choice.intents.includes(i)} onClick={() => toggleIntent(i)}>
                  {INTENT_LABEL[i]}
                </Chip>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase text-muted-foreground">
              Area
            </span>
            <Input
              value={choice.city}
              onChange={(e) => set({ city: e.target.value })}
              placeholder="City, e.g. Buford"
              maxLength={120}
            />
            {!choice.city.trim() && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Add your area so players nearby can find you.
              </span>
            )}
          </label>

          <Button className="h-12 w-full text-base" onClick={post} disabled={saving}>
            {saving ? "Posting…" : "Post availability"}
          </Button>
          {onMoreOptions && (
            <button
              type="button"
              onClick={onMoreOptions}
              className="mx-auto block text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline"
            >
              More options
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
