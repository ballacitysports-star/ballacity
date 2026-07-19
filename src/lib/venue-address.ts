// Shared validation for trainer session-venue addresses.
// Runs on the client (wizard + edit page) and mirrored in the server Zod schema
// so a hand-crafted API call can't bypass the same rules.

export type VenueAddressError = string | null;

const URLISH = /(https?:\/\/|www\.|<|>)/i;
const CONTROL = /[\u0000-\u001F\u007F]/;
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT_OR_COMMA = /[\d,]/;

export function validateVenueAddress(raw: string): {
  ok: boolean;
  error?: string;
  value: string;
} {
  const value = (raw ?? "").trim();
  if (value.length === 0) return { ok: false, error: "Address is required", value };
  if (value.length < 5) return { ok: false, error: "Address is too short", value };
  if (value.length > 200) return { ok: false, error: "Address is too long", value };
  if (CONTROL.test(value) || URLISH.test(value))
    return { ok: false, error: "Enter a plain address (no links)", value };
  if (!HAS_LETTER.test(value) || !HAS_DIGIT_OR_COMMA.test(value))
    return { ok: false, error: "Enter a full address (street, city)", value };
  return { ok: true, value };
}

export function validateVenueList(list: string[]): {
  errors: VenueAddressError[];
  hasError: boolean;
  deduped: string[];
  firstError: string | null;
} {
  const errors: VenueAddressError[] = [];
  const seen = new Map<string, number>();
  let firstError: string | null = null;

  list.forEach((raw, i) => {
    const res = validateVenueAddress(raw);
    let err: string | null = res.ok ? null : res.error ?? "Invalid address";
    if (!err) {
      const key = res.value.toLowerCase();
      if (seen.has(key)) err = "Duplicate address";
      else seen.set(key, i);
    }
    errors.push(err);
    if (err && !firstError) firstError = err;
  });

  const deduped = Array.from(seen.keys()).map((k) => list[seen.get(k)!].trim());
  return { errors, hasError: errors.some(Boolean), deduped, firstError };
}
