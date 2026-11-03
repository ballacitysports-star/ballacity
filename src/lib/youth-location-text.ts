/**
 * Does this free text give away a place? Client twin of `private_sec.text_discloses_location`
 * (supabase/migrations/20261104130000_location_text_detector.sql), used to tell a host before they publish. The
 * database enforces the rule whatever the client does (trigger `a0_guard_youth_game_public_text_trg`); this only
 * makes the refusal friendly. A test reads the SQL test file and checks both give the same answer for every case in it.
 *
 * It is a heuristic: it refuses a clear disclosure (an address, a map link, coordinates, a unit, the venue name) and
 * accepts an ordinary description of an area. It cannot catch every paraphrase.
 */

export type LocationDisclosure =
  "map_link" | "coordinates" | "street_address" | "unit" | "venue_name";

const STOP = new Set(
  (
    "the a an at of and park court courts gym gymnasium field fields center centre school rec recreation community " +
    "elementary middle high basketball soccer baseball softball football volleyball tennis indoor outdoor sports sport " +
    "club church playground pool arena stadium complex hall academy st street ave avenue rd road blvd dr drive ln lane " +
    "way ct pl place"
  ).split(" "),
);

const MAP_LINK =
  /(maps\.google|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple|waze\.com|openstreetmap\.org|bing\.com\/maps|w3w\.co|what3words|\/\/\/[a-z]+\.[a-z]+\.[a-z]+)/i;
const COORDINATES = /-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}/;
const STREET_WORDS =
  "st|street|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|ln|lane|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|ct|trl|trail";
const NOT_AN_ADDRESS =
  "am|pm|a\\.m|p\\.m|on|at|min|mins|minutes|hour|hours|hr|hrs|v|vs|x|players|people|ppl|spots|teams|games|rounds";
const STREET_ADDRESS = new RegExp(
  `\\b\\d{1,6}\\s+(?!(?:${NOT_AN_ADDRESS})\\b)(?:[a-z][a-z0-9.'-]*\\s+){1,3}(?:${STREET_WORDS})\\b`,
  "i",
);
const ORDINAL_STREET =
  /\b\d{1,3}(?:st|nd|rd|th)\s+(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane)\b/i;
const UNIT = /\b(?:apt|apartment|suite|ste|unit|bldg|building|room|rm)\.?\s*#?\s*\d+/i;

export function locationTokens(t: string | null | undefined): string[] {
  const s = (t ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s ? s.split(" ") : [];
}

export function textDisclosesLocation(
  text: string | null | undefined,
  exactLocation?: string | null,
): LocationDisclosure | null {
  const t = text ?? "";
  if (!t.trim()) return null;
  if (MAP_LINK.test(t)) return "map_link";
  if (COORDINATES.test(t)) return "coordinates";
  if (STREET_ADDRESS.test(t) || ORDINAL_STREET.test(t)) return "street_address";
  if (UNIT.test(t)) return "unit";

  if (exactLocation && exactLocation.trim()) {
    const norm = ` ${locationTokens(t).join(" ")} `;
    const segments = exactLocation.split(",");
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!(i === 0 || /\d/.test(seg))) continue; // later parts without digits are a city or state
      const toks = locationTokens(seg);
      if (toks.length < 2) continue;
      for (let j = 0; j < toks.length - 1; j++) {
        if (STOP.has(toks[j]) && STOP.has(toks[j + 1])) continue;
        if (toks[j].length + toks[j + 1].length < 5) continue;
        if (norm.includes(` ${toks[j]} ${toks[j + 1]} `)) return "venue_name";
      }
    }
  }
  return null;
}

const REASON_TEXT: Record<LocationDisclosure, string> = {
  map_link: "a map link",
  coordinates: "coordinates",
  street_address: "a street address",
  unit: "a unit or suite number",
  venue_name: "the venue name",
};

/**
 * First public text of a game that includes children that gives the place away, as a message for the host, or null.
 * `fields` maps a label the host recognises to the text in it.
 */
export function describeLocationInPublicText(
  fields: Record<string, string | null | undefined>,
  exactLocation: string | null | undefined,
): string | null {
  for (const [label, value] of Object.entries(fields)) {
    const reason =
      textDisclosesLocation(value, null) ?? textDisclosesLocation(value, exactLocation);
    if (reason) {
      return `Your ${label} includes ${REASON_TEXT[reason]}. Games that include children show only the area publicly. Describe the area instead (a neighborhood or city); the exact place is shared with people who have joined.`;
    }
  }
  return null;
}
