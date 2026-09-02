import { createFileRoute } from "@tanstack/react-router";

/**
 * Dynamic OpenGraph / Twitter card renderer.
 *
 * GET /api/public/og?kind=game&title=...&subtitle=...&meta=a|b|c&size=og
 *
 * `size` picks the output dimensions:
 *   og   -> 1200x630  (Facebook / LinkedIn / iMessage, og:image)
 *   wide -> 1600x900  (Twitter/X summary_large_image, crisper on retina)
 *   square -> 1200x1200 (fallback for square crops)
 *
 * Public on purpose: social crawlers are unauthenticated. It only renders the
 * text passed in the query string, so there is nothing privileged to leak.
 */

export const OG_SIZES = {
  og: { width: 1200, height: 630 },
  wide: { width: 1600, height: 900 },
  square: { width: 1200, height: 1200 },
} as const;

type SizeKey = keyof typeof OG_SIZES;

const KINDS: Record<string, { label: string; accent: string }> = {
  game: { label: "Pickup game", accent: "#C2F542" },
  player: { label: "Player", accent: "#7CE3F5" },
  team: { label: "Team", accent: "#FFB454" },
  trainer: { label: "Trainer", accent: "#FF8FA3" },
  venue: { label: "Venue", accent: "#A6F5C0" },
  page: { label: "ballaCity", accent: "#C2F542" },
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function fallbackSvg(opts: {
  kind: { label: string; accent: string };
  title: string;
  subtitle: string;
  width: number;
  height: number;
}) {
  const { kind, title, subtitle, width, height } = opts;
  const scale = width / 1200;
  const s = (value: number) => Math.round(value * scale);
  const titleSize = s(title.length > 40 ? 62 : 80);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#0C0F0B"/>
    <rect x="${s(72)}" y="${s(72)}" width="${s(56)}" height="${s(56)}" rx="${s(16)}" fill="${kind.accent}"/>
    <text x="${s(148)}" y="${s(116)}" fill="#F4F7F2" font-family="Arial, sans-serif" font-size="${s(40)}" font-weight="700">ballaCity</text>
    <rect x="${width - s(300)}" y="${s(72)}" width="${s(228)}" height="${s(58)}" rx="${s(29)}" fill="${kind.accent}"/>
    <text x="${width - s(186)}" y="${s(111)}" text-anchor="middle" fill="#0C0F0B" font-family="Arial, sans-serif" font-size="${s(26)}" font-weight="700">${esc(kind.label)}</text>
    <text x="${s(72)}" y="${Math.round(height * 0.55)}" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700">${esc(title)}</text>
    ${subtitle ? `<text x="${s(72)}" y="${Math.round(height * 0.68)}" fill="#A7B3A2" font-family="Arial, sans-serif" font-size="${s(34)}">${esc(subtitle)}</text>` : ""}
    <text x="${width - s(72)}" y="${height - s(72)}" text-anchor="end" fill="#6F7C6B" font-family="Arial, sans-serif" font-size="${s(26)}">open-run-connect.lovable.app</text>
  </svg>`;
}

/** Cache for a day in the browser, a year at the edge; previews are immutable per URL. */
const CACHE_CONTROL = "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, stale-if-error=604800, immutable";

/** Bump when the card design changes so old ETags stop matching. */
const OG_VERSION = "v1";

async function etagFor(parts: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${OG_VERSION}-${hex}"`;
}

const matchesEtag = (header: string | null, etag: string) => {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .includes(etag);
};

export const Route = createFileRoute("/api/public/og")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const kindKey = (url.searchParams.get("kind") ?? "page").toLowerCase();
        const kind = KINDS[kindKey] ?? KINDS["page"]!;
        const title = clamp(url.searchParams.get("title")?.trim() || "ballaCity", 90);
        const subtitle = clamp(url.searchParams.get("subtitle")?.trim() || "", 120);
        const meta = (url.searchParams.get("meta") ?? "")
          .split("|")
          .map((m) => clamp(m.trim(), 28))
          .filter(Boolean)
          .slice(0, 3);

        const sizeParam = (url.searchParams.get("size") ?? "og").toLowerCase();
        const sizeKey: SizeKey = sizeParam in OG_SIZES ? (sizeParam as SizeKey) : "og";
        const { width, height } = OG_SIZES[sizeKey];

        const etag = await etagFor(
          JSON.stringify([
            OG_VERSION,
            kindKey in KINDS ? kindKey : "page",
            sizeKey,
            title,
            subtitle,
            meta,
          ]),
        );

        const cacheHeaders = {
          "Cache-Control": CACHE_CONTROL,
          ETag: etag,
          Vary: "Accept-Encoding",
        };

        if (matchesEtag(request.headers.get("if-none-match"), etag)) {
          return new Response(null, { status: 304, headers: cacheHeaders });
        }

        // SVG is intentionally the canonical response. It is supported by social
        // crawlers and avoids native/WASM renderer assets that can prevent the
        // worker from starting before this route is ever requested.
        return new Response(fallbackSvg({ kind, title, subtitle, width, height }), {
          status: 200,
          headers: {
            ...cacheHeaders,
            "Content-Type": "image/svg+xml; charset=utf-8",
          },
        });
      },
    },
  },
});

