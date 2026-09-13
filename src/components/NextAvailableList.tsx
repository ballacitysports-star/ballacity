import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, MapPin, Sparkles } from "lucide-react";
import type { Org } from "@/lib/sample-data";
import {
  computeNextAvailable,
  candidateDateKeys,
  type NextAvailableSlot,
} from "@/lib/next-available";
import { listTrainerBookedSlots } from "@/lib/trainer-requests";
import { getBrowserTz, tzShortName } from "@/lib/tz";

const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = (h ?? 0) < 12 ? "AM" : "PM";
  const hr = (h ?? 0) % 12 || 12;
  return `${hr}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
};

function dayLabel(d: Date): string {
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function NextAvailableList({
  org,
  venueFilter,
  onPick,
  limit = 3,
  compact = false,
}: {
  org: Org;
  venueFilter?: string | null;
  onPick?: (slot: NextAvailableSlot) => void;
  limit?: number;
  compact?: boolean;
}) {
  const viewerTz = useMemo(() => getBrowserTz(), []);
  const trainerTz = org.timezone ?? null;
  const differ = !!(trainerTz && trainerTz !== viewerTz);

  const candidateKeys = useMemo(
    () => candidateDateKeys(org, { viewerTz, venueFilter, maxDays: 7 }),
    [org, viewerTz, venueFilter],
  );

  const { data: bookedByDate = {} } = useQuery({
    queryKey: ["trainer-booked-slots", org.id, venueFilter ?? "", candidateKeys.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        candidateKeys.map(async (key) => {
          try {
            const rows = await listTrainerBookedSlots(org.id, key);
            return [key, rows] as const;
          } catch {
            return [key, []] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: candidateKeys.length > 0,
    staleTime: 30_000,
  });

  const slots = useMemo(
    () =>
      computeNextAvailable(org, {
        viewerTz,
        venueFilter,
        bookedByDate,
        limit,
      }),
    [org, viewerTz, venueFilter, bookedByDate, limit],
  );

  if (candidateKeys.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted-foreground">
        No upcoming availability. Send a request and the trainer can propose a time.
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted-foreground">
        Fully booked in the next few days. Try a later date or a different venue.
      </div>
    );
  }

  const viewerShort = differ ? tzShortName(new Date(), viewerTz) : null;
  const trainerShort = differ && trainerTz ? tzShortName(new Date(), trainerTz) : null;

  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2"}>
      {slots.map((s, idx) => {
        const interactive = !!onPick;
        const Wrapper: any = interactive ? "button" : "div";
        return (
          <Wrapper
            key={`${s.dateKey}-${s.start}-${idx}`}
            type={interactive ? "button" : undefined}
            onClick={interactive ? () => onPick!(s) : undefined}
            className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
              interactive
                ? "border-lime/30 bg-lime/5 hover:border-lime hover:bg-lime/10"
                : "border-border bg-surface"
            }`}
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span>{dayLabel(s.date)}</span>
                <span className="text-muted-foreground">·</span>
                <span>
                  {fmt12(s.start)}–{fmt12(s.end)}
                </span>
                {viewerShort && (
                  <span className="rounded-full border border-border bg-background px-1.5 py-0.5 micro-label text-muted-foreground">
                    {viewerShort}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {differ && s.trainerStart && s.trainerEnd && (
                  <span>
                    trainer {fmt12(s.trainerStart)}–{fmt12(s.trainerEnd)}
                    {trainerShort ? ` ${trainerShort}` : ""}
                  </span>
                )}
                {s.venue && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="h-3 w-3" />
                    <span className="truncate max-w-[10rem]">{s.venue.split(",")[0]}</span>
                  </span>
                )}
                {s.source === "rule" && s.ruleLabel && (
                  <span className="inline-flex items-center gap-0.5 text-lime">
                    <Sparkles className="h-3 w-3" /> {s.ruleLabel}
                  </span>
                )}
              </div>
            </div>
            {interactive && (
              <span className="shrink-0 rounded-full border border-lime bg-lime px-3 py-1 text-[11px] font-bold text-primary-foreground group-hover:bg-lime/90">
                Book
              </span>
            )}
          </Wrapper>
        );
      })}
    </ul>
  );
}
