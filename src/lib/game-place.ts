/**
 * A short, human label for where a game is played, for cards and list rows.
 *
 * Venues are stored either as a name ("Tompkins Square Courts"), a name plus
 * address ("Coolray Field, 2500 Buford Dr, Lawrenceville, GA 30043, USA") or a
 * bare street address. Cards have room for one short phrase, so we keep the
 * venue name when there is one and fall back to "City, ST" for street
 * addresses. Returns null when nothing useful is known.
 */
export function gamePlaceLabel(game: {
  location?: string | null;
  neighborhood?: string | null;
}): string | null {
  const neighborhood = game.neighborhood?.trim() || null;
  const location = game.location?.trim() ?? "";
  if (!location || /^(tbd|tba|n\/a)$/i.test(location)) return neighborhood;

  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && /^(usa|us|united states( of america)?)$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  if (parts.length === 0) return neighborhood;

  const [first] = parts;
  // A leading house number means there's no venue name, just an address:
  // show the city (and state, when it's there) instead of the street.
  if (/^\d/.test(first) && parts.length >= 2) {
    const last = parts[parts.length - 1];
    const state = /^([A-Z]{2})(\s+\d{5}(-\d{4})?)?$/.exec(last)?.[1];
    if (state && parts.length >= 3) return `${parts[parts.length - 2]}, ${state}`;
    return neighborhood ?? parts[1];
  }
  return first;
}
