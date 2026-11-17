/**
 * The time window the Find Players "When" filter means, as real instants for the server search
 * (players_available_near takes [from, to)). Local calendar days, from now.
 */
export type WhenFilter = "any" | "today" | "week" | "weekend";

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Any time" still looks a fixed distance ahead: two weeks (the server allows up to 31 days). */
export const ANY_TIME_DAYS = 14;

function startOfDay(d: Date, plusDays = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays);
}

export function availabilityWindowFor(
  when: WhenFilter,
  now: Date = new Date(),
): { from: Date; to: Date } {
  switch (when) {
    case "today":
      return { from: now, to: startOfDay(now, 1) };
    case "week":
      return { from: now, to: new Date(now.getTime() + 7 * DAY_MS) };
    case "weekend": {
      const dow = now.getDay(); // 0 = Sunday, 6 = Saturday
      if (dow === 6 || dow === 0) {
        // Already the weekend: from now to the end of Sunday.
        return { from: now, to: startOfDay(now, dow === 6 ? 2 : 1) };
      }
      const toSaturday = 6 - dow;
      return { from: startOfDay(now, toSaturday), to: startOfDay(now, toSaturday + 2) };
    }
    default:
      return { from: now, to: new Date(now.getTime() + ANY_TIME_DAYS * DAY_MS) };
  }
}
