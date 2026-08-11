import { createFileRoute } from "@tanstack/react-router";
import { ImageResponse } from "@cf-wasm/og";
import { htmlToReact } from "@cf-wasm/og/html-to-react";

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
  page: { label: "OpenRun", accent: "#C2F542" },
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function template(opts: {
  kind: { label: string; accent: string };
  title: string;
  subtitle: string;
  meta: string[];
  width: number;
  height: number;
}) {
  const { kind, title, subtitle, meta, width, height } = opts;
  // Scale every dimension off the 1200x630 base so each preset stays identical
  // in composition, just rendered at higher pixel density / aspect ratio.
  const s = (n: number) => Math.round(n * (width / 1200));
  const chips = meta
    .map(
      (m) =>
        `<div style="display:flex;padding:${s(8)}px ${s(22)}px;border-radius:999px;background:#1A2118;border:${Math.max(2, s(2))}px solid #2A331F;color:#E8EDE6;font-size:${s(28)}px;">${esc(m)}</div>`,
    )
    .join("");

  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:${width}px;height:${height}px;padding:${s(72)}px;background:#0C0F0B;font-family:sans-serif;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;">
        <div style="display:flex;width:${s(56)}px;height:${s(56)}px;border-radius:${s(16)}px;background:${kind.accent};"></div>
        <div style="display:flex;margin-left:${s(20)}px;color:#F4F7F2;font-size:${s(40)}px;font-weight:700;">OpenRun</div>
      </div>
      <div style="display:flex;padding:${s(12)}px ${s(26)}px;border-radius:999px;background:${kind.accent};color:#0C0F0B;font-size:${s(26)}px;font-weight:700;">${esc(kind.label)}</div>
    </div>
    <div style="display:flex;flex-direction:column;">
      <div style="display:flex;color:#FFFFFF;font-size:${s(title.length > 40 ? 62 : 80)}px;font-weight:700;line-height:1.05;">${esc(title)}</div>
      ${subtitle ? `<div style="display:flex;margin-top:${s(24)}px;color:#A7B3A2;font-size:${s(34)}px;line-height:1.25;">${esc(subtitle)}</div>` : ""}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;gap:${s(16)}px;max-width:${s(800)}px;overflow:hidden;">${chips}</div>
      <div style="display:flex;flex-shrink:0;margin-left:${s(32)}px;color:#6F7C6B;font-size:${s(26)}px;white-space:nowrap;">open-run-connect.lovable.app</div>
    </div>
  </div>`;
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
        const title = clamp(url.searchParams.get("title")?.trim() || "OpenRun", 90);
        const subtitle = clamp(url.searchParams.get("subtitle")?.trim() || "", 120);
        const meta = (url.searchParams.get("meta") ?? "")
          .split("|")
          .map((m) => clamp(m.trim(), 28))
          .filter(Boolean)
          .slice(0, 3);

        const etag = await etagFor(
          JSON.stringify([OG_VERSION, kindKey in KINDS ? kindKey : "page", title, subtitle, meta]),
        );

        const cacheHeaders = {
          "Cache-Control": CACHE_CONTROL,
          ETag: etag,
          Vary: "Accept-Encoding",
        };

        if (matchesEtag(request.headers.get("if-none-match"), etag)) {
          return new Response(null, { status: 304, headers: cacheHeaders });
        }

        try {
          return new ImageResponse(htmlToReact(template({ kind, title, subtitle, meta })), {
            width: OG_WIDTH,
            height: OG_HEIGHT,
            format: "png",
            headers: { ...cacheHeaders, "Content-Type": "image/png" },
          });
        } catch (err) {
          return new Response(`OG render failed: ${(err as Error).message}`, {
            status: 500,
            headers: { "Cache-Control": "no-store" },
          });
        }
      },
    },
  },
});

