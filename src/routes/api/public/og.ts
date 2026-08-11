import { createFileRoute } from "@tanstack/react-router";
import { ImageResponse } from "@cf-wasm/og";
import { htmlToReact } from "@cf-wasm/og/html-to-react";

/**
 * Dynamic OpenGraph / Twitter card renderer.
 *
 * GET /api/public/og?kind=game&title=...&subtitle=...&meta=a|b|c
 *
 * Public on purpose: social crawlers are unauthenticated. It only renders the
 * text passed in the query string, so there is nothing privileged to leak.
 */

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

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
}) {
  const { kind, title, subtitle, meta } = opts;
  const chips = meta
    .map(
      (m) =>
        `<div style="display:flex;padding:8px 22px;border-radius:999px;background:#1A2118;border:2px solid #2A331F;color:#E8EDE6;font-size:28px;">${esc(m)}</div>`,
    )
    .join("");

  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:${OG_WIDTH}px;height:${OG_HEIGHT}px;padding:72px;background:#0C0F0B;font-family:sans-serif;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;">
        <div style="display:flex;width:56px;height:56px;border-radius:16px;background:${kind.accent};"></div>
        <div style="display:flex;margin-left:20px;color:#F4F7F2;font-size:40px;font-weight:700;">OpenRun</div>
      </div>
      <div style="display:flex;padding:12px 26px;border-radius:999px;background:${kind.accent};color:#0C0F0B;font-size:26px;font-weight:700;">${esc(kind.label)}</div>
    </div>
    <div style="display:flex;flex-direction:column;">
      <div style="display:flex;color:#FFFFFF;font-size:${title.length > 40 ? 62 : 80}px;font-weight:700;line-height:1.05;">${esc(title)}</div>
      ${subtitle ? `<div style="display:flex;margin-top:24px;color:#A7B3A2;font-size:34px;line-height:1.25;">${esc(subtitle)}</div>` : ""}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;gap:16px;max-width:800px;overflow:hidden;">${chips}</div>
      <div style="display:flex;flex-shrink:0;margin-left:32px;color:#6F7C6B;font-size:26px;white-space:nowrap;">open-run-connect.lovable.app</div>
    </div>
  </div>`;
}

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

        try {
          return new ImageResponse(htmlToReact(template({ kind, title, subtitle, meta })), {
            width: OG_WIDTH,
            height: OG_HEIGHT,
            format: "png",
            headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
          });
        } catch (err) {
          return new Response(`OG render failed: ${(err as Error).message}`, { status: 500 });
        }
      },
    },
  },
});
