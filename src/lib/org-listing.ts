import { hasAnyHours, type OrgHours } from "@/lib/org-hours";

/** Primary business categories offered for facility listings. */
export const ORG_CATEGORIES = [
  "Gym",
  "Basketball gym",
  "Indoor courts",
  "Outdoor courts",
  "Pickleball courts",
  "Tennis courts",
  "Soccer field",
  "Football field",
  "Baseball / softball field",
  "Track",
  "Ice rink",
  "Swimming pool",
  "Sports complex",
  "Recreation center",
  "Fieldhouse",
  "Training facility",
  "Court rental",
  "Fitness studio",
  "Other",
] as const;

export type OrgCategory = (typeof ORG_CATEGORIES)[number];

/**
 * Amenity chips, grouped so the editor can present courts, gear and
 * facilities separately. The flat {@link ORG_AMENITIES} list is derived from
 * this and stays the single source of truth for what can be stored.
 */
export const ORG_AMENITY_GROUPS = [
  {
    id: "courts",
    label: "Courts & surfaces",
    items: [
      "Hardwood courts",
      "Indoor courts",
      "Outdoor courts",
      "Outdoor cages",
      "Turf field",
      "Sport court (synthetic)",
      "Full-court runs",
      "Half courts",
      "Pickleball courts",
    ],
  },
  {
    id: "gear",
    label: "Gear & rentals",
    items: [
      "Ball rentals",
      "Scoreboards",
      "Shot clocks",
      "Adjustable hoops",
      "Shooting machines",
      "Weight room",
    ],
  },
  {
    id: "facility",
    label: "Facility",
    items: [
      "Lighting",
      "Air conditioning",
      "Spectator seating",
      "Parking",
      "Restrooms",
      "Showers",
      "Lockers",
      "Concessions",
      "Wi-Fi",
      "Accessible entrance",
    ],
  },
  {
    id: "programs",
    label: "Programs & bookings",
    items: [
      "Open runs",
      "Court rentals",
      "Leagues",
      "Clinics & camps",
      "Tournaments",
      "Kids programs",
      "Birthday parties",
    ],
  },
] as const;

/** Amenity chips shown on the listing. */
export const ORG_AMENITIES = ORG_AMENITY_GROUPS.flatMap((g) => g.items) as readonly string[];

export type OrgAmenity = string;

/** Most amenities a listing may carry (court count included). */
export const MAX_ORG_AMENITIES = 60;

const COURT_COUNT_RE = /^(\d{1,3}) courts?$/i;
export const MAX_COURT_COUNT = 99;

/** Display label for a court count, e.g. "1 court" / "4 courts". */
export function courtCountLabel(n: number): string {
  return `${n} ${n === 1 ? "court" : "courts"}`;
}

/**
 * The court count lives in the amenities list as a readable "4 courts" entry,
 * so it needs no extra column and still renders sensibly everywhere amenities
 * are shown. Returns null when none is set.
 */
export function courtCountFromAmenities(
  amenities: readonly string[] | null | undefined,
): number | null {
  for (const a of amenities ?? []) {
    const m = COURT_COUNT_RE.exec(a.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

/** Replace (or clear, when `count` is null/0) the court count entry. */
export function withCourtCount(
  amenities: readonly string[] | null | undefined,
  count: number | null,
): string[] {
  const rest = (amenities ?? []).filter((a) => !COURT_COUNT_RE.test(a.trim()));
  const n = count == null ? 0 : Math.min(MAX_COURT_COUNT, Math.max(0, Math.floor(count)));
  return n > 0 ? [courtCountLabel(n), ...rest] : rest;
}

export type ListingCompleteness = {
  name: string;
  handle: string;
  category: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  bio: string;
  hours: OrgHours;
  amenities: string[];
  photos: string[];
  avatarUrl: string;
  coverUrl: string;
};

export type StrengthItem = {
  id: string;
  label: string;
  /** DOM id of the editor section this item belongs to. */
  section: string;
  weight: number;
  done: boolean;
};

/**
 * Score how complete a gym listing is, mirroring what a Google Business
 * Profile nags you about. Returns 0–100 plus the missing checklist.
 */
export function scoreListing(v: ListingCompleteness): {
  percent: number;
  items: StrengthItem[];
  missing: StrengthItem[];
} {
  const items: StrengthItem[] = [
    {
      id: "name",
      label: "Add a business name",
      section: "org-business",
      weight: 15,
      done: v.name.trim().length >= 2,
    },
    {
      id: "handle",
      label: "Pick a handle",
      section: "org-about",
      weight: 10,
      done: v.handle.trim().length >= 3,
    },
    {
      id: "category",
      label: "Choose a category",
      section: "org-business",
      weight: 10,
      done: !!v.category,
    },
    {
      id: "address",
      label: "Add your address",
      section: "org-business",
      weight: 15,
      done: v.address.trim().length > 4,
    },
    {
      id: "phone",
      label: "Add a phone number",
      section: "org-contact",
      weight: 10,
      done: v.phone.trim().length >= 7,
    },
    {
      id: "contact",
      label: "Add a website or email",
      section: "org-contact",
      weight: 5,
      done: !!v.website.trim() || !!v.email.trim(),
    },
    {
      id: "hours",
      label: "Set your hours",
      section: "org-hours",
      weight: 15,
      done: hasAnyHours(v.hours),
    },
    {
      id: "amenities",
      label: "Pick at least 3 amenities",
      section: "org-amenities",
      weight: 5,
      done: v.amenities.filter((a) => !COURT_COUNT_RE.test(a.trim())).length >= 3,
    },
    { id: "logo", label: "Upload a logo", section: "org-photos", weight: 5, done: !!v.avatarUrl },
    {
      id: "photos",
      label: "Add 3 photos",
      section: "org-photos",
      weight: 5,
      done: v.photos.length + (v.coverUrl ? 1 : 0) >= 3,
    },
    {
      id: "bio",
      label: "Describe your gym",
      section: "org-about",
      weight: 5,
      done: v.bio.trim().length >= 40,
    },
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  return {
    percent: Math.round((earned / total) * 100),
    items,
    missing: items.filter((i) => !i.done),
  };
}

const PHONE_RE = /^[+]?[\d\s().-]{7,20}(\s*(?:x|ext\.?|extension)\s*\d{1,6})?$/i;

export function isValidPhone(v: string): boolean {
  return PHONE_RE.test(v.trim());
}

/** Splits a phone string into its dialable digits and optional extension. */
function splitPhone(v: string): { number: string; ext: string | null } {
  const raw = String(v ?? "").trim();
  const m = raw.match(/(?:x|ext\.?|extension)\s*(\d{1,6})\s*$/i);
  const ext = m ? m[1] : null;
  const head = m ? raw.slice(0, m.index) : raw;
  const plus = head.trimStart().startsWith("+") ? "+" : "";
  const digits = head.replace(/\D/g, "");
  return { number: plus + digits, ext };
}

/** True when the value has enough digits to actually place a call. */
export function isDialable(v: string | null | undefined): boolean {
  if (!v) return false;
  const { number } = splitPhone(v);
  return number.replace(/\D/g, "").length >= 7;
}

/** `tel:` href with separators stripped, a single leading `+`, and `;ext=`. */
export function telHref(v: string | null | undefined): string | null {
  if (!isDialable(v)) return null;
  const { number, ext } = splitPhone(String(v));
  return `tel:${number}${ext ? `;ext=${ext}` : ""}`;
}

/** `mailto:` href for a plausible address, else null. */
export function emailHref(v: string | null | undefined): string | null {
  const raw = String(v ?? "").trim();
  if (!raw || /\s/.test(raw)) return null;
  if (!/^[^@]+@[^@.]+(\.[^@.]+)+$/.test(raw)) return null;
  return `mailto:${raw}`;
}

/** Normalizes a stored website value into a safe absolute http(s) URL. */
export function websiteHref(v: string | null | undefined): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:/i.test(raw)) return null;
  const candidate = hasScheme ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Google Maps directions URL, or null when there is no usable destination. */
export function directionsHref(opts: {
  address?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string | null {
  const address = String(opts.address ?? "").trim();
  const hasCoords =
    typeof opts.lat === "number" &&
    Number.isFinite(opts.lat) &&
    typeof opts.lng === "number" &&
    Number.isFinite(opts.lng);
  const dest = hasCoords ? `${opts.lat},${opts.lng}` : address;
  if (!dest) return null;
  const params = new URLSearchParams({ api: "1", destination: dest });
  if (opts.placeId) params.set("destination_place_id", opts.placeId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Suggest a handle from a facility name, e.g. "Peak Gym & Courts" → "peak-gym-courts". */
export function suggestHandle(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Amenities worth showing first on a directory card, in priority order. */
const HIGHLIGHT_AMENITIES = [
  "Hardwood courts",
  "Indoor courts",
  "Outdoor courts",
  "Outdoor cages",
  "Turf field",
  "Sport court (synthetic)",
  "Lighting",
  "Parking",
  "Ball rentals",
  "Scoreboards",
  "Air conditioning",
  "Lockers",
] as const;

/**
 * Pick the amenity tags for a directory card: the court count first, then the
 * highest-priority features the facility actually has. `more` is how many
 * further amenities were left off.
 */
export function highlightAmenities(
  amenities: readonly string[] | null | undefined,
  max = 5,
): { tags: string[]; more: number } {
  const list = (amenities ?? []).filter(Boolean);
  const courts = courtCountFromAmenities(list);
  const rest = list.filter((a) => courtCountFromAmenities([a]) === null);
  const ranked = [
    ...HIGHLIGHT_AMENITIES.filter((a) => rest.includes(a)),
    ...rest.filter((a) => !(HIGHLIGHT_AMENITIES as readonly string[]).includes(a)),
  ];
  const tags = [...(courts ? [courtCountLabel(courts)] : []), ...ranked].slice(0, max);
  return { tags, more: Math.max(0, (courts ? 1 : 0) + ranked.length - tags.length) };
}

/**
 * Where "Book court" should send a player: the facility's dedicated booking
 * link, else its website, else null (the in-app inquiry is used instead).
 */
export function bookingHref(org: {
  booking_url?: string | null;
  website?: string | null;
}): string | null {
  return websiteHref(org.booking_url) ?? websiteHref(org.website);
}
