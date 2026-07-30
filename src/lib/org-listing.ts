import { hasAnyHours, type OrgHours } from "@/lib/org-hours";

/** Primary business categories offered for gym listings. */
export const ORG_CATEGORIES = [
  "Gym",
  "Fitness studio",
  "Training facility",
  "Court rental",
  "Sports complex",
  "Other",
] as const;

export type OrgCategory = (typeof ORG_CATEGORIES)[number];

/** Amenity chips shown on the listing. */
export const ORG_AMENITIES = [
  "Parking",
  "Showers",
  "Lockers",
  "Indoor courts",
  "Outdoor courts",
  "Weight room",
  "Turf field",
  "Kids programs",
  "Accessible entrance",
  "Wi-Fi",
] as const;

export type OrgAmenity = (typeof ORG_AMENITIES)[number];

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
    { id: "name", label: "Add a business name", section: "org-business", weight: 15, done: v.name.trim().length >= 2 },
    { id: "handle", label: "Pick a handle", section: "org-about", weight: 10, done: v.handle.trim().length >= 3 },
    { id: "category", label: "Choose a category", section: "org-business", weight: 10, done: !!v.category },
    { id: "address", label: "Add your address", section: "org-business", weight: 15, done: v.address.trim().length > 4 },
    { id: "phone", label: "Add a phone number", section: "org-contact", weight: 10, done: v.phone.trim().length >= 7 },
    {
      id: "contact",
      label: "Add a website or email",
      section: "org-contact",
      weight: 5,
      done: !!v.website.trim() || !!v.email.trim(),
    },
    { id: "hours", label: "Set your hours", section: "org-hours", weight: 15, done: hasAnyHours(v.hours) },
    { id: "amenities", label: "Pick at least 3 amenities", section: "org-amenities", weight: 5, done: v.amenities.length >= 3 },
    { id: "logo", label: "Upload a logo", section: "org-photos", weight: 5, done: !!v.avatarUrl },
    {
      id: "photos",
      label: "Add 3 photos",
      section: "org-photos",
      weight: 5,
      done: v.photos.length + (v.coverUrl ? 1 : 0) >= 3,
    },
    { id: "bio", label: "Describe your gym", section: "org-about", weight: 5, done: v.bio.trim().length >= 40 },
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  return {
    percent: Math.round((earned / total) * 100),
    items,
    missing: items.filter((i) => !i.done),
  };
}

const PHONE_RE = /^[+]?[\d\s().-]{7,20}$/;

export function isValidPhone(v: string): boolean {
  return PHONE_RE.test(v.trim());
}

export function telHref(v: string): string {
  return `tel:${v.replace(/[^\d+]/g, "")}`;
}

export function directionsHref(opts: {
  address?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  const params = new URLSearchParams({ api: "1" });
  const dest = opts.address || (opts.lat != null && opts.lng != null ? `${opts.lat},${opts.lng}` : "");
  params.set("destination", dest);
  if (opts.placeId) params.set("destination_place_id", opts.placeId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
