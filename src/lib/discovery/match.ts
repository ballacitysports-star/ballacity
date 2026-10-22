/**
 * Telling whether a discovered organization is one we already list.
 *
 * Names are compared as sets of meaningful words, so "The Atlanta Hoops
 * Academy, LLC" and "Atlanta Hoops Academy" match. A match is a hint to the
 * reviewer, never an automatic merge — except an exact one, which is skipped
 * rather than shown twice.
 */

const STOP_WORDS = new Set(["the", "of", "and", "inc", "llc", "ltd", "co", "corp", "at", "in"]);

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameTokens(name: string): string[] {
  const tokens = normalizeName(name)
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t));
  return [...new Set(tokens)];
}

function normalizeCity(city: string | null | undefined): string {
  return normalizeName(city ?? "");
}

/** Stable key for "this organization of this type in this city". */
export function fingerprint(type: string, name: string, city: string | null | undefined): string {
  return `${type}|${[...nameTokens(name)].sort().join(" ")}|${normalizeCity(city)}`;
}

export function similarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const inter = tb.filter((t) => sa.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

export type KnownListing = {
  kind: "team" | "gym" | "candidate";
  id: string;
  name: string;
  city: string | null;
  website?: string | null;
};

export type DuplicateHit = { kind: KnownListing["kind"]; id: string; name: string; score: number };

/** At or above this a match is the same organization and is not listed twice. */
export const EXACT_DUPLICATE = 0.95;
/** At or above this the reviewer is warned. */
export const POSSIBLE_DUPLICATE = 0.7;

/**
 * Best match among known listings. Same city (or an unknown one) and the same
 * website host raise the score; a different city lowers it, since chains and
 * common names repeat across towns — but not below a warning, because in a metro
 * area one gym is often listed under a neighboring suburb.
 */
export function findDuplicate(
  candidate: { name: string; city: string | null; websiteHost?: string },
  known: readonly KnownListing[],
  hostOf: (url: string) => string,
): DuplicateHit | null {
  const city = normalizeCity(candidate.city);
  let best: DuplicateHit | null = null;
  for (const k of known) {
    let score = similarity(candidate.name, k.name);
    const kCity = normalizeCity(k.city);
    if (city && kCity && city !== kCity) score *= 0.8;
    if (candidate.websiteHost && k.website && hostOf(k.website) === candidate.websiteHost) {
      score = Math.max(score, 0.9);
    }
    if (score >= POSSIBLE_DUPLICATE && (!best || score > best.score)) {
      best = { kind: k.kind, id: k.id, name: k.name, score: Math.round(score * 100) / 100 };
    }
  }
  return best;
}

/** A URL-safe handle from a name, e.g. "Peach State Hoops" → "peach-state-hoops". */
export function slugify(name: string, max = 40): string {
  const slug = normalizeName(name).replace(/ /g, "-");
  return slug.slice(0, max).replace(/-+$/g, "");
}

/** The nth handle to try for a name: base, base-city, base-2, base-3 … */
export function handleCandidates(
  name: string,
  city: string | null | undefined,
  tries = 5,
): string[] {
  const base = slugify(name) || "listing";
  const c = slugify(city ?? "", 20);
  const out = [base];
  if (c && !base.endsWith(c)) out.push(`${base}-${c}`);
  for (let i = 2; out.length < tries; i++) out.push(`${base}-${i}`);
  return out.slice(0, tries);
}
