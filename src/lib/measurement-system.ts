// Detects whether the user's region uses imperial (miles) or metric (km),
// based purely on the device locale and timezone. No network, no geolocation
// permission prompt. SSR-safe: falls back to "mi" when there is no navigator.

export type DistanceUnit = "mi" | "km";

// Regions that use miles for road/travel distances.
const IMPERIAL_REGIONS = new Set([
  "US", // United States
  "AS", // American Samoa
  "GU", // Guam
  "MP", // Northern Mariana Islands
  "PR", // Puerto Rico
  "UM", // U.S. Minor Outlying Islands
  "VI", // U.S. Virgin Islands
  "LR", // Liberia
  "MM", // Myanmar
  "GB", // United Kingdom (road distances in miles)
  "BS", // Bahamas
  "BZ", // Belize
  "KY", // Cayman Islands
  "FK", // Falkland Islands
  "WS", // Samoa
]);

// Timezone prefixes / exact zones that imply an imperial region, used when the
// locale carries no region subtag (e.g. plain "en").
const IMPERIAL_TIMEZONE_PREFIXES = [
  "America/Adak",
  "America/Anchorage",
  "America/Boise",
  "America/Chicago",
  "America/Denver",
  "America/Detroit",
  "America/Indiana/",
  "America/Juneau",
  "America/Kentucky/",
  "America/Los_Angeles",
  "America/Menominee",
  "America/Metlakatla",
  "America/New_York",
  "America/Nome",
  "America/North_Dakota/",
  "America/Phoenix",
  "America/Puerto_Rico",
  "America/Sitka",
  "America/Yakutat",
  "Europe/London",
  "Pacific/Guam",
  "Pacific/Honolulu",
  "Pacific/Pago_Pago",
  "Pacific/Saipan",
  "Africa/Monrovia",
  "Asia/Yangon",
  "Asia/Rangoon",
  "US/",
];

function regionFromLocale(locale: string): string | null {
  try {
    const anyIntl = Intl as unknown as {
      Locale?: new (tag: string) => { region?: string; maximize?: () => { region?: string } };
    };
    if (anyIntl.Locale) {
      const loc = new anyIntl.Locale(locale);
      // Only trust an explicit region subtag — maximize() would guess "en" -> US.
      if (loc.region) return loc.region.toUpperCase();
    }
  } catch {
    /* fall through to manual parsing */
  }
  const parts = locale.split(/[-_]/);
  const candidate = parts.find((p) => /^[A-Za-z]{2}$/.test(p) && p === p.toUpperCase());
  return candidate ? candidate.toUpperCase() : null;
}

function unitFromMeasurementSystem(locale: string): DistanceUnit | null {
  try {
    const anyIntl = Intl as unknown as {
      Locale?: new (tag: string) => {
        measurementSystem?: string;
        getMeasurementSystem?: () => string;
        maximize?: () => { measurementSystem?: string; getMeasurementSystem?: () => string };
      };
    };
    if (!anyIntl.Locale) return null;
    const loc = new anyIntl.Locale(locale);
    const maxed = loc.maximize?.() ?? loc;
    const system =
      maxed.measurementSystem ??
      maxed.getMeasurementSystem?.() ??
      loc.measurementSystem ??
      loc.getMeasurementSystem?.();
    if (system === "us" || system === "uksystem") return "mi";
    if (system === "metric") return "km";
  } catch {
    /* ignore */
  }
  return null;
}

function unitFromTimeZone(): DistanceUnit | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return null;
    return IMPERIAL_TIMEZONE_PREFIXES.some((p) => (p.endsWith("/") ? tz.startsWith(p) : tz === p))
      ? "mi"
      : "km";
  } catch {
    return null;
  }
}

/** Detect the distance unit for the current device. Pure; no caching. */
export function detectDistanceUnit(): DistanceUnit {
  if (typeof navigator === "undefined") return "mi";

  const locales: string[] = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    ...(navigator.language ? [navigator.language] : []),
  ].filter(Boolean);

  for (const locale of locales) {
    const region = regionFromLocale(locale);
    if (region) return IMPERIAL_REGIONS.has(region) ? "mi" : "km";
  }

  // No explicit region: the timezone is a better regional signal than a
  // maximized locale (bare "en" maximizes to en-US everywhere).
  const byZone = unitFromTimeZone();
  if (byZone) return byZone;

  for (const locale of locales) {
    const bySystem = unitFromMeasurementSystem(locale);
    if (bySystem) return bySystem;
  }

  return "mi";
}

let cached: DistanceUnit | null = null;

/** Memoized per session so repeated renders don't re-run Intl lookups. */
export function getDetectedDistanceUnit(): DistanceUnit {
  if (cached == null) cached = detectDistanceUnit();
  return cached;
}

/** Test helper — clears the memoized detection result. */
export function resetDetectedDistanceUnit() {
  cached = null;
}
