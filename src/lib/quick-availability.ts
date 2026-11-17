/**
 * "I'm available": the three-tap availability post. Everything a returning player already told us (sport, level, city)
 * comes from their profile; they pick a day, a time of day, and whether it repeats every week.
 */
import type { PlayerAvailability } from "./availability";
import { buildSkillFields, type AvailabilityIntent } from "./availability-levels";
import { TIME_PRESETS, toDateKey, toMin, type TimeSlot } from "./availability-timeslots";
import { miToKm } from "./distance";
import { levelTiers, type SportLevel } from "./sport-levels";

export type QuickDay = "today" | "tomorrow" | { date: string };

export type QuickChoice = {
  sport: string;
  day: QuickDay;
  /** One of TIME_PRESETS' ids: morning, afternoon, evening, allday. */
  timeId: string;
  weekly: boolean;
  intents: AvailabilityIntent[];
  city: string;
};

export type QuickProfile = {
  sports: { name: string; level?: SportLevel | null }[];
  city?: string | null;
};

/** 25 miles, the full form's default, in whole kilometres (the column is an integer, as miToKm rounds). */
export const QUICK_TRAVEL_RADIUS_KM = miToKm(25);

export function quickDefaults(profile: QuickProfile | null, now: Date = new Date()): QuickChoice {
  const sport = profile?.sports.find((s) => s.name)?.name ?? "Basketball";
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Late in the day, default to tomorrow evening rather than a time that has passed.
  const evening = TIME_PRESETS.find((p) => p.id === "evening")!;
  const day: QuickDay = nowMin < toMin(evening.end) - 60 ? "today" : "tomorrow";
  return {
    sport,
    day,
    timeId: "evening",
    weekly: false,
    intents: ["pickup"],
    city: profile?.city ?? "",
  };
}

export function quickDateKey(day: QuickDay, now: Date = new Date()): string {
  if (typeof day === "object") return day.date;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day === "tomorrow") d.setDate(d.getDate() + 1);
  return toDateKey(d);
}

export type QuickPayload = Partial<PlayerAvailability>;

/** The post to create, or an error to show. Never touches the network. */
export function buildQuickPost(
  choice: QuickChoice,
  profile: QuickProfile | null,
  now: Date = new Date(),
): { ok: true; payload: QuickPayload } | { ok: false; error: string } {
  const preset = TIME_PRESETS.find((p) => p.id === choice.timeId);
  if (!preset) return { ok: false, error: "Pick a time of day." };
  if (!choice.sport) return { ok: false, error: "Pick a sport." };
  const dateKey = quickDateKey(choice.day, now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return { ok: false, error: "Pick a day." };

  const todayKey = toDateKey(now);
  if (dateKey < todayKey) return { ok: false, error: "Pick today or a later day." };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (!choice.weekly && dateKey === todayKey && toMin(preset.end) <= nowMin) {
    return {
      ok: false,
      error: `${preset.label} has already passed today. Pick another time or day.`,
    };
  }

  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  const slot: TimeSlot = choice.weekly
    ? { weekday, start: preset.start, end: preset.end }
    : { date: dateKey, start: preset.start, end: preset.end };

  const level = profile?.sports.find((s) => s.name === choice.sport)?.level ?? null;
  return {
    ok: true,
    payload: {
      sports: [choice.sport],
      ...buildSkillFields([choice.sport], { [choice.sport]: levelTiers(level) }),
      looking_for: choice.intents,
      time_slots: [slot],
      city: choice.city.trim() || null,
      travel_radius_km: QUICK_TRAVEL_RADIUS_KM,
    },
  };
}
