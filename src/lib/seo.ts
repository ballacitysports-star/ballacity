/**
 * Canonical head-metadata helpers.
 *
 * Every route builds its `head()` from `pageHead()` so titles, descriptions,
 * Open Graph / Twitter tags, canonical links, and robots directives stay
 * consistent across the app. New pages should call this instead of hand
 * writing meta arrays.
 */
export const SITE_URL = "https://open-run-connect.lovable.app";
export const SITE_NAME = "OpenRun";

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
    meta.push({ property: "og:image", content: absoluteImage });
    meta.push({ name: "twitter:image", content: absoluteImage });
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
