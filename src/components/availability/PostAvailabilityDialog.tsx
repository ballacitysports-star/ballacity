import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SPORTS, type Sport } from "@/lib/sample-data";
import {
  createAvailability,
  updateAvailability,
  type PlayerAvailability,
} from "@/lib/availability";
import { useAvailabilityGate, availabilityGateMessage } from "@/lib/availability-gate";
import {
  AVAILABILITY_INTENTS,
  INTENT_BLURB,
  INTENT_LABEL,
  buildSkillFields,
  initialLevelsForPost,
  parseIntents,
  type AvailabilityIntent,
} from "@/lib/availability-levels";
import { AvailabilitySchedulePicker } from "@/components/availability/AvailabilitySchedulePicker";
import { useMyBusyBlocks } from "@/lib/availability-conflicts";
import { parseTimeSlots, type TimeSlot } from "@/lib/availability-timeslots";
import { errorText, userErrorMessage } from "@/lib/user-error";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { kmToMi, miToKm, maxDistanceInUnit } from "@/lib/distance";
import { useDistanceUnit, useMyProfile } from "@/lib/user-prefs-store";
import { DistanceSlider } from "@/components/DistanceSlider";
import { levelTiers, scaleForSport } from "@/lib/sport-levels";
import { TierChips } from "@/components/sports/TierChips";
import { useDefaultSports } from "@/lib/default-sports";

/** The sentence createAvailability throws itself when the session is gone (src/lib/availability.ts). */
const SIGN_IN_TO_POST = "Sign in to post availability.";

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${active ? "border-lime bg-lime/15 text-foreground" : "border-border bg-surface text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

/**
 * The full availability form ("More options" from the quick sheet, and editing a post): several days, levels per
 * sport, a note and a travel radius. Shared by Find Players and My availability & invitations.
 */
export function PostAvailabilityDialog({
  initial,
  onClose,
  onPosted,
}: {
  /** When set, the dialog edits this existing post instead of creating one. */
  initial?: PlayerAvailability | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const myProfile = useMyProfile();
  const gate = useAvailabilityGate();
  const isEdit = !!initial;
  const { sports: mySports } = useDefaultSports();
  // New posts start from the viewer's profile sports; edits keep their own.
  const [sports, setSports] = useState<string[]>(initial?.sports ?? []);
  const sportsTouchedRef = useRef(false);
  useEffect(() => {
    if (initial || sportsTouchedRef.current || !mySports.length) return;
    setSports((cur) => (cur.length ? cur : mySports));
  }, [initial, mySports]);
  // Per-sport tiers — a player can be open to several competitive levels.
  const [levels, setLevels] = useState<Record<string, string[]>>(() =>
    initial ? initialLevelsForPost(initial) : {},
  );
  const [lookingFor, setLookingFor] = useState<AvailabilityIntent[]>(() =>
    parseIntents(initial?.looking_for),
  );

  const [slots, setSlots] = useState<TimeSlot[]>(() =>
    initial ? parseTimeSlots(initial.time_slots ?? []) : [],
  );
  const { data: busy = [] } = useMyBusyBlocks();
  const [city, setCity] = useState(initial?.city ?? "");
  const unit = useDistanceUnit();
  const [radius, setRadius] = useState(() => {
    const km = initial?.travel_radius_km ?? 40.2336;
    return Math.round(unit === "km" ? km : kmToMi(km));
  }); // in the viewer's unit
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    // Belt-and-braces: a stale dialog or deep link can't bypass the gate.
    if (!gate.loading && !gate.canPost) {
      toast.error(availabilityGateMessage(gate.reason));
      return;
    }
    if (sports.length === 0 && !note.trim()) {
      toast.error("Pick at least one sport or add a note.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        sports,
        ...buildSkillFields(sports, levels),
        looking_for: lookingFor,

        // datetime-local gives "YYYY-MM-DDTHH:mm"; DB columns are DATE → store date portion only.
        time_slots: slots,
        city,
        travel_radius_km: unit === "km" ? radius : miToKm(radius),
        note,
      };
      if (initial) await updateAvailability(initial.id, payload);
      else await createAvailability(payload);
      onPosted();
    } catch (e: unknown) {
      // createAvailability's own "Sign in to post availability." still shows; anything else is never raw text.
      toast.error(
        errorText(e) === SIGN_IN_TO_POST
          ? SIGN_IN_TO_POST
          : userErrorMessage(e, "Couldn't save your availability. Please try again."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit availability" : "Post availability"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Sports</Label>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((s) => (
                <Chip
                  key={s.name}
                  active={sports.includes(s.name)}
                  onClick={() => {
                    sportsTouchedRef.current = true;
                    setSports((arr) => {
                      const next = toggle(arr, s.name);
                      // Prefill from the profile tiers the first time a sport is added.
                      if (!arr.includes(s.name)) {
                        const mine = levelTiers(
                          myProfile?.sports.find((x) => x.name === s.name)?.level,
                        );
                        if (mine.length)
                          setLevels((l) => (l[s.name]?.length ? l : { ...l, [s.name]: mine }));
                      }
                      return next;
                    });
                  }}
                >
                  <span className="mr-1">{s.emoji}</span>
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
          {sports.length === 0 ? (
            <p className="text-xs text-muted-foreground">Pick a sport to set your level for it.</p>
          ) : (
            sports.map((name) => {
              const scale = scaleForSport(name as Sport);
              return (
                <div key={name}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <Label className="block">{name} levels</Label>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {scale.system}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Pick all that fit
                    </span>
                  </div>
                  <TierChips
                    scale={scale}
                    selected={levels[name] ?? []}
                    ariaPrefix={name}
                    onToggle={(tier) =>
                      setLevels((l) => {
                        const cur = l[name] ?? [];
                        return {
                          ...l,
                          [name]: cur.includes(tier)
                            ? cur.filter((t) => t !== tier)
                            : [...cur, tier],
                        };
                      })
                    }
                  />
                </div>
              );
            })
          )}
          <div>
            <Label className="mb-2 block">Available as</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Available as">
              {AVAILABILITY_INTENTS.map((intent) => (
                <Chip
                  key={intent}
                  active={lookingFor.includes(intent)}
                  onClick={() =>
                    setLookingFor((cur) =>
                      cur.includes(intent) ? cur.filter((x) => x !== intent) : [...cur, intent],
                    )
                  }
                >
                  {INTENT_LABEL[intent]}
                </Chip>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {lookingFor.length === 0
                ? "Optional. Pick one or both."
                : lookingFor.map((i) => INTENT_BLURB[i]).join(" · ")}
            </p>
          </div>
          <div>
            <Label className="mb-2 block">When are you free?</Label>
            <AvailabilitySchedulePicker value={slots} onChange={setSlots} busy={busy} />
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Austin"
              />
            </div>
            <div>
              <Label>Travel radius</Label>
              <DistanceSlider
                valueMi={
                  radius >= maxDistanceInUnit(unit)
                    ? null
                    : unit === "km"
                      ? radius / 1.609344
                      : radius
                }
                onChange={(mi) =>
                  setRadius(
                    mi == null
                      ? maxDistanceInUnit(unit)
                      : Math.round(unit === "km" ? miToKm(mi) : mi),
                  )
                }
                unit={unit}
                label="Travel radius"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="note">Short note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Positions, goals, what you're looking for…"
            />
            <p className="mt-1 text-[10px] text-muted-foreground text-right">{note.length}/500</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-lime-gradient text-primary-foreground"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? "Save" : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
