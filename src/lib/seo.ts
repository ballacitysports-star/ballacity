/**
 * Canonical head-metadata helpers.
 *
 * Every route builds its `head()` from `pageHead()` so titles, descriptions,
 * Open Graph / Twitter tags, canonical links, and robots directives stay
 * consistent across the app. New pages should call this instead of hand
 * writing meta arrays.
 */
export const SITE_URL = "https://ballacity.com";
export const SITE_NAME = "ballaCity";
/** The site’s own title and description. Pages either use these verbatim or
 *  prefix/suffix their own page name onto them, so the wording stays in one place. */
export const SITE_TITLE = "BallaCity | Find Games, Join Teams — Your City's Sports Network";
export const SITE_DESCRIPTION =
  "Find pickup games, team tryouts and camps, trainers and gyms near you. Post your availability so coaches can find you — basketball, soccer, baseball, pickleball and more.";


type MetaTag = Record<string, string>;

export type PageHeadInput = {
  /** Absolute path of the page, e.g. "/plans". Omit for private dynamic pages. */
  path?: string;
  title: string;
  description: string;
  /** Open Graph type; "website" by default. */
  ogType?: string;
  /** Absolute https image URL for the share preview. Leaf routes only. */
  image?: string | null;
  /** Keep the page out of search results (anything behind sign-in). */
  noindex?: boolean;
  /** Structured data for this page. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

export function pageHead(input: PageHeadInput) {
  const { path, title, description, ogType = "website", image, noindex, jsonLd } = input;
  const url = path ? `${SITE_URL}${path}` : null;
  const absoluteImage = image && /^https?:\/\//.test(image) ? image : null;

  const meta: MetaTag[] = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: ogType },
    { property: "og:site_name", content: SITE_NAME },
    { name: "twitter:card", content: absoluteImage ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (url) meta.push({ property: "og:url", content: url });
  if (absoluteImage) {
    // Generated cards come in several presets: serve 1200x630 to OpenGraph
    // consumers and the sharper 1600x900 render to Twitter/X.
    const isGenerated = absoluteImage.includes("/api/public/og");
    const ogImage = isGenerated ? withOgSize(absoluteImage, "og") : absoluteImage;
    const twitterImage = isGenerated ? withOgSize(absoluteImage, "wide") : absoluteImage;
    meta.push({ property: "og:image", content: ogImage });
    meta.push({ property: "og:image:secure_url", content: ogImage });
    meta.push({ property: "og:image:type", content: isGenerated ? "image/png" : "image/jpeg" });
    if (isGenerated) {
      meta.push({ property: "og:image:width", content: String(OG_IMAGE_SIZES.og.width) });
      meta.push({ property: "og:image:height", content: String(OG_IMAGE_SIZES.og.height) });
    }
    meta.push({ property: "og:image:alt", content: title });
    meta.push({ name: "twitter:image", content: twitterImage });
    meta.push({ name: "twitter:image:alt", content: title });
  }
  if (noindex) meta.push({ name: "robots", content: "noindex, nofollow" });

  const head: {
    meta: MetaTag[];
    links?: { rel: string; href: string }[];
    scripts?: { type: string; children: string }[];
  } = { meta };

  if (url && !noindex) head.links = [{ rel: "canonical", href: url }];
  if (jsonLd && !noindex) {
    head.scripts = (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).map((entry) => ({
      type: "application/ld+json",
      children: JSON.stringify(entry),
    }));
  }
  return head;
}

/**
 * Build an absolute URL for the dynamically rendered share card
 * (`/api/public/og`). Used by games, profiles, teams, trainers, and venues so
 * every link preview shares one visual template.
 */
export type OgCardKind = "game" | "player" | "team" | "trainer" | "venue" | "page";

/** Output presets served by /api/public/og. */
export const OG_IMAGE_SIZES = {
  og: { width: 1200, height: 630 },
  wide: { width: 1600, height: 900 },
  square: { width: 1200, height: 1200 },
} as const;

export type OgImageSize = keyof typeof OG_IMAGE_SIZES;

export function ogImageUrl(input: {
  kind: OgCardKind;
  title: string;
  subtitle?: string | null;
  /** Up to 3 short facts rendered as chips. */
  meta?: (string | null | undefined)[];
  /** Output dimensions; defaults to the 1200x630 OpenGraph preset. */
  size?: OgImageSize;
}) {
  const params = new URLSearchParams({ kind: input.kind, title: input.title.slice(0, 90) });
  if (input.subtitle) params.set("subtitle", input.subtitle.slice(0, 120));
  const meta = (input.meta ?? []).filter((m): m is string => Boolean(m && m.trim())).slice(0, 3);
  if (meta.length) params.set("meta", meta.join("|"));
  params.set("size", input.size ?? "og");
  return `${SITE_URL}/api/public/og?${params.toString()}`;
}

/** Swap the `size` preset on a generated card URL. */
export function withOgSize(imageUrl: string, size: OgImageSize) {
  try {
    const parsed = new URL(imageUrl, SITE_URL);
    if (!parsed.pathname.startsWith("/api/public/og")) return imageUrl;
    parsed.searchParams.set("size", size);
    return parsed.toString();
  } catch {
    return imageUrl;
  }
}
