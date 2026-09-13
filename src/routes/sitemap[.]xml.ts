import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SITE_URL } from "@/lib/seo";
import { SPORT_GUIDE_SLUGS } from "@/lib/sports-guide";


interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

/**
 * Public, indexable routes only. Signed-in surfaces (feed, discover, profile,
 * settings, messages, payments, onboarding, admin, edit screens) are marked
 * noindex via pageHead() and are intentionally excluded.
 */
const ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/orgs", changefreq: "daily", priority: "0.8" },
  { path: "/plans", changefreq: "monthly", priority: "0.7" },
  { path: "/shop", changefreq: "weekly", priority: "0.6" },
  { path: "/guide", changefreq: "monthly", priority: "0.8" },
  ...SPORT_GUIDE_SLUGS.map(
    (slug): SitemapEntry => ({
      path: `/guide/${slug}`,
      changefreq: "monthly",
      priority: "0.7",
    }),
  ),



  { path: "/safety", changefreq: "monthly", priority: "0.7" },
  { path: "/trust-center", changefreq: "monthly", priority: "0.7" },
  { path: "/community-guidelines", changefreq: "yearly", priority: "0.5" },
  { path: "/contact", changefreq: "yearly", priority: "0.5" },
  { path: "/terms", changefreq: "yearly", priority: "0.4" },
  { path: "/privacy", changefreq: "yearly", priority: "0.4" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls = ENTRIES.map((e) =>
          [
            `  <url>`,
            `    <loc>${SITE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
