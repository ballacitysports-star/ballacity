import { formatGameWhen } from "@/lib/format";
import type { PublicGameSeo } from "@/lib/city-seo";
import { ogImageUrl, pageHead } from "@/lib/seo";

const GENERIC_TITLE = "Pickup game";
const GENERIC_DESCRIPTION =
  "See the details for this pickup game and request to join on BallaCity.";

/**
 * Head metadata for /games/<id>. `seo` is non-null only for a game that is public to
 * everyone (getPublicGameSeo); anything else gets one generic, noindex head that is
 * identical for every game, so the title, description, Open Graph and Twitter tags and
 * the share-card URL say nothing about a restricted game or whether it exists.
 */
export function gamePageHead(gameId: string, seo: PublicGameSeo | null) {
  if (!seo) {
    return pageHead({
      path: `/games/${gameId}`,
      title: `${GENERIC_TITLE} — BallaCity`,
      description: GENERIC_DESCRIPTION,
      ogType: "article",
      noindex: true,
      image: ogImageUrl({
        kind: "game",
        title: GENERIC_TITLE,
        subtitle: "Pickup game on BallaCity",
      }),
    });
  }
  return pageHead({
    path: `/games/${gameId}`,
    title: `${seo.title} — BallaCity`,
    description: (seo.description || GENERIC_DESCRIPTION).slice(0, 155),
    ogType: "article",
    noindex: false,
    image: ogImageUrl({
      kind: "game",
      title: seo.title,
      subtitle: [seo.sport, seo.neighborhood || seo.location].filter(Boolean).join(" • "),
      meta: [
        formatGameWhen({ date: seo.date }),
        seo.location,
        seo.price ? `$${seo.price}` : "Free",
      ],
    }),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: seo.title,
      startDate: seo.date,
      location: { "@type": "Place", name: seo.location, address: seo.neighborhood },
      sport: seo.sport,
      url: `https://ballacity.com/games/${gameId}`,
    },
  });
}

/** How long the game page's loader waits for the head's public facts before using the generic head. */
export const GAME_SEO_DEADLINE_MS = 3000;

/**
 * The public facts for a game's head, or null when they are missing, the read fails, or it
 * takes longer than `deadlineMs`.
 *
 * The route loader awaits this before the page renders, and on a first load that happens on
 * the server, before any HTML is sent. With no deadline a slow or unreachable database held
 * the whole document: the browser never got past navigating, the page never rendered, and
 * the E2E pay and game-page specs failed with `page.goto: net::ERR_ABORTED` at their 60s
 * timeout. The head only decorates the page, and null already means "generic head".
 */
export async function loadGameSeoWithin(
  load: () => Promise<PublicGameSeo | null>,
  deadlineMs: number = GAME_SEO_DEADLINE_MS,
): Promise<PublicGameSeo | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    return await Promise.race([load().catch(() => null), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
