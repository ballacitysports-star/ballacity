import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SITE_URL } from "@/lib/seo";
import { SPORT_GUIDE_SLUGS } from "@/lib/sports-guide";
import { SPORT_HUB_SLUGS } from "@/lib/sport-hubs";
import { facilitySitemapEntries } from "@/lib/org-seo";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
  /** YYYY-MM-DD of the last real change. */
  lastmod?: string;
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
  ...SPORT_HUB_SLUGS.map(
    (slug): SitemapEntry => ({ path: `/${slug}`, changefreq: "daily", priority: "0.9" }),
  ),
  { path: "/guide", changefreq: "monthly", priority: "0.8" },
  ...SPORT_GUIDE_SLUGS.map(
    (slug): SitemapEntry => ({
      path: `/guide/${slug}`,
      changefreq: "monthly",
      priority: "0.7",
    }),
  ),




  { path: "/blog/how-to-find-pickup-soccer-games", changefreq: "monthly", priority: "0.7" },

  { path: "/safety", changefreq: "monthly", priority: "0.7" },
  { path: "/trust-center", changefreq: "monthly", priority: "0.7" },
  { path: "/community-guidelines", changefreq: "yearly", priority: "0.5" },
  { path: "/contact", changefreq: "yearly", priority: "0.5" },
  { path: "/terms", changefreq: "yearly", priority: "0.4" },
  { path: "/privacy", changefreq: "yearly", priority: "0.4" },
  { path: "/payment-policy", changefreq: "yearly", priority: "0.4" },
  { path: "/ai-disclosure", changefreq: "yearly", priority: "0.4" },
  { path: "/youth-policy", changefreq: "yearly", priority: "0.4" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Don't advertise pages that sell nothing. The shop is switched off
        // while BallaCity is free, and /plans has no prices on it, so both are
        // dropped from the sitemap until monetization returns.
        //
        // Imported inside the handler: this route is part of the client graph
        // (routeTree.gen.ts), so a top-level import would pull server-only code
        // into the browser bundle.
        let merchEnabled = false;
        let subscriptionsEnabled = false;
        try {
          const [{ supabaseAdmin }, { loadMonetizationConfig }, { resolveFeatureAccess }] =
            await Promise.all([
              import("@/integrations/supabase/client.server"),
              import("@/lib/monetization/settings.server"),
              import("@/lib/monetization/access"),
            ]);
          const config = await loadMonetizationConfig(supabaseAdmin);
          const access = resolveFeatureAccess(config);
          merchEnabled = access.merchEnabled;
          // /plans still exists while free, but it sells nothing, so there is
          // nothing for a search engine to index.
          subscriptionsEnabled = !access.freeMode;
        } catch {
          // A settings read failure must not break the sitemap; omitting /shop
          // is the safe direction.
        }

        // Public facility pages, so search engines can find each gym without
        // having to crawl through the directory. Hidden facilities are
        // excluded explicitly because this reads with the service role.
        let facilityEntries: SitemapEntry[] = [];
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("trainer_orgs")
            .select("id, updated_at")
            .is("hidden_at", null)
            .order("updated_at", { ascending: false })
            .limit(5000);
          facilityEntries = facilitySitemapEntries(data ?? []);
        } catch {
          // A read failure must not break the sitemap; omitting gyms is safe.
        }

        // Launch-city pages and public games, teams and trainers. Each rule
        // for what is safe to list lives in city-seo; city pages below the
        // listing threshold are left out so thin pages never get submitted.
        let cityEntries: SitemapEntry[] = [];
        try {
          const { loadCitySitemapEntries } = await import("@/lib/city-sitemap.server");
          cityEntries = await loadCitySitemapEntries();
        } catch {
          // A read failure must not break the sitemap; omitting them is safe.
        }

        const entries = [
          { path: "/cities", changefreq: "weekly" as const, priority: "0.7" },
          ...ENTRIES,
          ...facilityEntries,
          ...cityEntries,
        ].filter(
          (e) =>
            (e.path !== "/shop" || merchEnabled) && (e.path !== "/plans" || subscriptionsEnabled),
        );

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${SITE_URL}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
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
