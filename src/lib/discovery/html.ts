/**
 * Turns a fetched web page into the compact text the extractor reads.
 *
 * No DOM is available where this runs, so it works on the markup directly.
 * Besides the visible text it keeps the page title, meta description and any
 * schema.org JSON-LD blocks: businesses often publish name, address and sports
 * there in a clean, reliable form.
 */

export type PageText = {
  title: string;
  description: string;
  /** Raw JSON-LD blocks, trimmed. */
  jsonLd: string[];
  text: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : " ";
    }
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

function metaContent(html: string, key: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${key}["'][^>]*>|<meta[^>]+content=["'][^"']*["'][^>]+(?:name|property)=["']${key}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : "";
}

const JSON_LD_BUDGET = 4000;

/**
 * Visible text, title, description and JSON-LD of an HTML page.
 * Long pages keep their start and their end, where footers carry addresses.
 */
export function htmlToPageText(html: string, maxChars = 12000): PageText {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const description = (
    metaContent(html, "description") || metaContent(html, "og:description")
  ).slice(0, 400);

  const jsonLd: string[] = [];
  let budget = JSON_LD_BUDGET;
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const block = m[1].trim();
    if (!block || budget <= 0) continue;
    jsonLd.push(block.slice(0, budget));
    budget -= block.length;
  }

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/address)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(stripped)
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const clipped =
    text.length <= maxChars
      ? text
      : `${text.slice(0, Math.floor(maxChars * 0.75))}\n…\n${text.slice(-Math.floor(maxChars * 0.25))}`;
  return { title, description, jsonLd, text: clipped };
}

/** True when a page has too little readable text to extract from (script-rendered). */
export function isThinPage(page: PageText): boolean {
  return page.text.length + page.jsonLd.join("").length < 400;
}
