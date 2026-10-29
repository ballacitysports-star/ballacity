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
