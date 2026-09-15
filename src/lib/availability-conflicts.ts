import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  isDateSlot,
  parseTimeSlots,
  toDateKey,
  toMin,
  fmt12,
  fmtShortDate,
  type TimeSlot,
} from "./availability-timeslots";

/** A block of time the player is already committed to (or has marked off). */
export type BusyBlock = {
  id: string;
  /** YYYY-MM-DD in the viewer's local time. */
  date: string;
  start: string; // HH:MM
  end: string; // HH:MM
  label: string;
  kind: "joined" | "hosting" | "unavailable" | "posted";
};

export type SlotConflict = {
  slotIndex: number;
  slot: TimeSlot;
  /** The occurrence that clashes — weekly slots resolve to a concrete date. */
  date: string;
  blocks: BusyBlock[];
};

export const CONFLICT_KIND_LABEL: Record<BusyBlock["kind"], string> = {
  joined: "Game you joined",
  hosting: "Game you host",
  unavailable: "Marked unavailable",
  posted: "Another availability post",
};

const parseDurationMinutes = (raw: string | null | undefined): number => {
  if (!raw) return 90;
  const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 90;
  return /hour|hr\b/i.test(raw) && n <= 12 ? n * 60 : n;
};

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Turn a game start timestamp + duration string into a local-day busy block. */
export function gameToBusyBlock(
  game: { id: string; title: string | null; date: string; duration: string | null },
  kind: BusyBlock["kind"],
): BusyBlock | null {
  const start = new Date(game.date);
  if (Number.isNaN(start.getTime())) return null;
  const mins = parseDurationMinutes(game.duration);
  const end = new Date(start.getTime() + mins * 60_000);
  // Clip to the start day so comparisons stay within one date key.
  const sameDayEnd = end.getDate() === start.getDate() ? hhmm(end) : "23:59";
  return {
    id: `${kind}:${game.id}`,
    date: toDateKey(start),
    start: hhmm(start),
    end: sameDayEnd,
    label: game.title?.trim() || "Game",
    kind,
  };
}

/**
 * Everything on the signed-in player's calendar that a new availability window
 * could clash with: games they joined or host, closed availability posts
 * ("marked unavailable"), and their other open posts.
 */
export async function listMyBusyBlocks(
  opts: { excludeAvailabilityId?: string } = {},
): Promise<BusyBlock[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];

  const out: BusyBlock[] = [];
  const fromIso = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [{ data: parts }, { data: hosted }, { data: avails }] = await Promise.all([
    supabase.from("game_participants").select("game_id").eq("user_id", uid),
    supabase
      .from("hosted_games")
      .select("id, title, date, duration")
      .eq("host_id", uid)
      .gte("date", fromIso),
    supabase
      .from("player_availabilities" as any)
      .select("id, status, time_slots, note")
      .eq("user_id", uid),
  ]);

  const joinedIds = (parts ?? []).map((p) => p.game_id);
  if (joinedIds.length > 0) {
    const { data: joinedGames } = await supabase
      .from("hosted_games")
      .select("id, title, date, duration, host_id")
      .in("id", joinedIds)
      .gte("date", fromIso);
    for (const g of joinedGames ?? []) {
      const b = gameToBusyBlock(g, g.host_id === uid ? "hosting" : "joined");
      if (b) out.push(b);
    }
  }
  for (const g of hosted ?? []) {
    const b = gameToBusyBlock(g, "hosting");
    if (b && !out.some((x) => x.id === b.id)) out.push(b);
  }

  const today = toDateKey(new Date());
  for (const row of (avails ?? []) as any[]) {
    if (opts.excludeAvailabilityId && row.id === opts.excludeAvailabilityId) continue;
    const kind: BusyBlock["kind"] = row.status === "closed" ? "unavailable" : "posted";
    const label =
      kind === "unavailable" ? "Marked unavailable" : row.note?.slice(0, 40) || "Your availability";
    for (const s of parseTimeSlots(row.time_slots ?? [])) {
      if (isDateSlot(s)) {
        if (s.date < today) continue;
        out.push({
          id: `${kind}:${row.id}:${s.date}:${s.start}`,
          date: s.date,
          start: s.start,
          end: s.end,
          label,
          kind,
        });
      } else {
        // Expand the weekly window across the next 8 weeks so recurring
        // clashes surface too.
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        for (let i = 0; i < 56; i++) {
          const d = new Date(base);
          d.setDate(base.getDate() + i);
          if (d.getDay() !== s.weekday) continue;
          const key = toDateKey(d);
          out.push({
            id: `${kind}:${row.id}:${key}:${s.start}`,
            date: key,
            start: s.start,
            end: s.end,
            label,
            kind,
          });
        }
      }
    }
  }

  return out;
}

const overlapsTime = (aS: string, aE: string, bS: string, bE: string) =>
  toMin(aS) < toMin(bE === "24:00" ? "23:59" : bE) &&
  toMin(bS) < toMin(aE === "24:00" ? "23:59" : aE);

/**
 * Match each selected slot against the player's busy blocks.
 * Weekly slots are expanded across `horizonDays` so recurring clashes appear.
 */
export function findSlotConflicts(
  slots: TimeSlot[],
  busy: BusyBlock[],
  opts: { now?: Date; horizonDays?: number } = {},
): SlotConflict[] {
  const { now = new Date(), horizonDays = 56 } = opts;
  if (slots.length === 0 || busy.length === 0) return [];
  const byDate = new Map<string, BusyBlock[]>();
  for (const b of busy) {
    if (!byDate.has(b.date)) byDate.set(b.date, []);
    byDate.get(b.date)!.push(b);
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: SlotConflict[] = [];

  slots.forEach((slot, slotIndex) => {
    const dates: string[] = [];
    if (isDateSlot(slot)) {
      dates.push(slot.date);
    } else {
      for (let i = 0; i < horizonDays; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        if (d.getDay() === slot.weekday) dates.push(toDateKey(d));
      }
    }
    for (const date of dates) {
      const hits = (byDate.get(date) ?? []).filter((b) =>
        overlapsTime(slot.start, slot.end, b.start, b.end),
      );
      if (hits.length > 0) {
        out.push({ slotIndex, slot, date, blocks: hits });
        // One warning per slot is enough for recurring windows.
        break;
      }
    }
  });

  return out;
}

/** Overlapping windows *within* the current selection (e.g. two weekly Sats). */
export function findSelfOverlaps(slots: TimeSlot[]): number[] {
  const bad = new Set<number>();
  slots.forEach((a, i) => {
    slots.forEach((b, j) => {
      if (j <= i) return;
      const sameDay = isDateSlot(a)
        ? isDateSlot(b) && a.date === b.date
        : !isDateSlot(b) && a.weekday === b.weekday;
      if (sameDay && overlapsTime(a.start, a.end, b.start, b.end)) {
        bad.add(i);
        bad.add(j);
      }
    });
  });
  return [...bad];
}

export function describeConflict(c: SlotConflict): string {
  const b = c.blocks[0];
  const extra = c.blocks.length > 1 ? ` +${c.blocks.length - 1} more` : "";
  return `${fmtShortDate(c.date)} ${fmt12(c.slot.start)}–${fmt12(c.slot.end)} overlaps “${b.label}” (${fmt12(b.start)}–${fmt12(b.end)})${extra}`;
}

// ---------------------------------------------------------------------------
// Quick fixes offered straight from a conflict warning
// ---------------------------------------------------------------------------

const MIN_WINDOW = 30; // minutes — anything shorter isn't worth posting
const DAY_END = 23 * 60 + 59;

const fromMin = (m: number) => {
  const c = Math.max(0, Math.min(DAY_END, Math.round(m)));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};

export type SlotFixId = "skip" | "shorten" | "remove";

export type SlotFix = {
  id: SlotFixId;
  label: string;
  /** Longer explanation for the button title / a11y. */
  hint: string;
  /** The replacement slot — omitted for "remove". */
  slot?: TimeSlot;
};

/** Merged span of the blocks a slot collides with. */
function busySpan(c: SlotConflict) {
  const start = Math.min(...c.blocks.map((b) => toMin(b.start)));
  const end = Math.max(...c.blocks.map((b) => toMin(b.end === "24:00" ? "23:59" : b.end)));
  return { start, end };
}

/**
 * Actionable ways to clear a conflict without leaving the picker:
 *  - skip:    move the whole window to start when the busy block ends
 *  - shorten: trim the window to the larger free side of the busy block
 *  - remove:  drop the window entirely
 */
export function suggestSlotFixes(c: SlotConflict): SlotFix[] {
  const slot = c.slot;
  const s = toMin(slot.start);
  const e = toMin(slot.end === "24:00" ? "23:59" : slot.end);
  const dur = Math.max(MIN_WINDOW, e - s);
  const busy = busySpan(c);
  const fixes: SlotFix[] = [];

  // Skip to the next free window — same length, starting after the clash.
  if (busy.end + MIN_WINDOW <= DAY_END) {
    const nextStart = busy.end;
    const nextEnd = Math.min(DAY_END, nextStart + dur);
    if (nextEnd - nextStart >= MIN_WINDOW) {
      fixes.push({
        id: "skip",
        label: `Skip to ${fmt12(fromMin(nextStart))}`,
        hint: `Move this window to ${fmt12(fromMin(nextStart))}–${fmt12(fromMin(nextEnd))}, right after “${c.blocks[0].label}”.`,
        slot: { ...slot, start: fromMin(nextStart), end: fromMin(nextEnd) } as TimeSlot,
      });
    }
  }

  // Shorten — keep whichever free side of the clash is longer.
  const beforeLen = busy.start - s;
  const afterLen = e - busy.end;
  if (Math.max(beforeLen, afterLen) >= MIN_WINDOW) {
    const useBefore = beforeLen >= afterLen;
    const start = useBefore ? s : busy.end;
    const end = useBefore ? busy.start : e;
    const already = fromMin(start) === slot.start && fromMin(end) === slot.end;
    const dupOfSkip = fixes.some(
      (f) =>
        f.slot && (f.slot as any).start === fromMin(start) && (f.slot as any).end === fromMin(end),
    );
    if (!already && !dupOfSkip) {
      fixes.push({
        id: "shorten",
        label: useBefore ? `End at ${fmt12(fromMin(end))}` : `Start at ${fmt12(fromMin(start))}`,
        hint: `Shorten to ${fmt12(fromMin(start))}–${fmt12(fromMin(end))} so it stops clashing.`,
        slot: { ...slot, start: fromMin(start), end: fromMin(end) } as TimeSlot,
      });
    }
  }

  fixes.push({
    id: "remove",
    label: "Remove",
    hint: "Drop this window from your availability.",
  });

  return fixes;
}

/** Drop every window that overlaps an earlier one, keeping the first. */
export function dropOverlappingSlots(slots: TimeSlot[]): TimeSlot[] {
  const kept: TimeSlot[] = [];
  for (const s of slots) {
    const clashes = kept.some((k) => {
      const sameDay = isDateSlot(k)
        ? isDateSlot(s) && k.date === s.date
        : !isDateSlot(s) && k.weekday === s.weekday;
      return sameDay && overlapsTime(k.start, k.end, s.start, s.end);
    });
    if (!clashes) kept.push(s);
  }
  return kept;
}

/** Busy blocks for the signed-in player, cached for a minute. */
export function useMyBusyBlocks(opts: { excludeAvailabilityId?: string; enabled?: boolean } = {}) {
  const { excludeAvailabilityId, enabled = true } = opts;
  return useQuery({
    queryKey: ["my-busy-blocks", excludeAvailabilityId ?? null],
    queryFn: () => listMyBusyBlocks({ excludeAvailabilityId }),
    enabled,
    staleTime: 60_000,
  });
}
