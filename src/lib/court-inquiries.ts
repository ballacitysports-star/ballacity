import { z } from "zod";
import { formatTime } from "@/lib/org-hours";

/** Sports a court inquiry can be for. */
export const INQUIRY_SPORTS = [
  "Basketball",
  "Volleyball",
  "Pickleball",
  "Soccer",
  "Other",
] as const;

/** Court / area the player wants. */
export const COURT_TYPES = [
  { value: "any", label: "No preference" },
  { value: "full_court", label: "Full court" },
  { value: "half_court", label: "Half court" },
  { value: "turf", label: "Turf" },
  { value: "cage", label: "Cage" },
] as const;
export type CourtType = (typeof COURT_TYPES)[number]["value"];

/** Older inquiries used indoor/outdoor; keep their labels readable. */
const LEGACY_COURT_LABELS: Record<string, string> = { indoor: "Indoor", outdoor: "Outdoor" };

/** A rough part of the day, or an exact start time. */
export const TIME_SLOTS = [
  { value: "morning", label: "Morning", hint: "before noon" },
  { value: "afternoon", label: "Afternoon", hint: "noon – 5 PM" },
  { value: "evening", label: "Evening", hint: "after 5 PM" },
  { value: "custom", label: "Specific time", hint: "" },
] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number]["value"];

export const INQUIRY_DURATIONS = [
  { min: 60, label: "1 hour" },
  { min: 90, label: "1.5 hours" },
  { min: 120, label: "2 hours" },
  { min: 180, label: "3 hours" },
  { min: 240, label: "4 hours" },
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for a Date in UTC. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A requested date must be today or later (one day of slack so a viewer ahead
 * of UTC isn't rejected for "today") and within a year.
 */
export function isRequestableDate(date: string, now: number = Date.now()): boolean {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return false;
  return date >= isoDay(new Date(now - DAY_MS)) && date <= isoDay(new Date(now + 366 * DAY_MS));
}

export const courtInquirySchema = z
  .object({
    orgId: z.string().uuid(),
    sport: z.enum(INQUIRY_SPORTS, { message: "Pick a sport" }),
    courtType: z.enum(["any", "full_court", "half_court", "turf", "cage"]),
    date: z.string().refine((d) => isRequestableDate(d), "Pick a date from today onward"),
    timeSlot: z.enum(["morning", "afternoon", "evening", "custom"]),
    startTime: z.string().regex(TIME_RE, "Pick a start time").optional(),
    durationMin: z.number().int().min(30).max(480),
    playerCount: z.number().int().min(1, "At least 1 player").max(200),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.timeSlot === "custom" ? !!v.startTime : !v.startTime), {
    message: "Pick a start time",
    path: ["startTime"],
  });
export type CourtInquiryInput = z.infer<typeof courtInquirySchema>;

/** First validation error message, or null when the form is valid. */
export function validateCourtInquiry(v: unknown): string | null {
  const r = courtInquirySchema.safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? "Check the form");
}

export function courtTypeLabel(t: string): string {
  return COURT_TYPES.find((c) => c.value === t)?.label ?? LEGACY_COURT_LABELS[t] ?? "No preference";
}

export function timeSlotLabel(slot: string): string {
  return TIME_SLOTS.find((t) => t.value === slot)?.label ?? "Specific time";
}

export function durationLabel(min: number): string {
  const known = INQUIRY_DURATIONS.find((d) => d.min === min);
  if (known) return known.label;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} hour${h === 1 ? "" : "s"}` : `${min} min`;
}

/**
 * "Sat, Oct 10 · Evening · 2 hours" or "Sat, Oct 10 · 6 PM · 2 hours" for a
 * stored inquiry (an exact time may arrive as "HH:MM:SS").
 */
export function formatInquiryWhen(
  date: string,
  startTime: string | null,
  durationMin: number,
  timeSlot: string = "custom",
): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  const when =
    timeSlot !== "custom" || !startTime
      ? timeSlotLabel(timeSlot)
      : formatTime(startTime.slice(0, 5));
  return `${day} · ${when} · ${durationLabel(durationMin)}`;
}
