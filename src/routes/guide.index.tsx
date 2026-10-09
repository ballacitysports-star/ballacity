import { createFileRoute, Link } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { PolicyLinks } from "@/components/PolicyLinks";
import { pageHead, SITE_URL } from "@/lib/seo";
import { SPORT_GUIDES } from "@/lib/sports-guide";

const TITLE = "Sports Guide — how pickup games work | BallaCity";
const DESCRIPTION =
  "How pickup games work in basketball, soccer, baseball, softball, football, volleyball, tennis, pickleball and running: group sizes, gear, positions, etiquette and how to join a game.";

export const Route = createFileRoute("/guide/")({
  head: () =>
    pageHead({
      path: "/guide",
      title: TITLE,
      description: DESCRIPTION,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "BallaCity Sports Guide",
        itemListElement: SPORT_GUIDES.map((g, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `${g.sport} pickup guide`,
          url: `${SITE_URL}/guide/${g.slug}`,
        })),
      },
    }),
  component: GuideIndex,
});

function GuideIndex() {
  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Sports Guide" fallbackTo="/feed" />

      <main className="page-shell-prose py-6 pb-28">
        <h1 className="page-title">Sports Guide</h1>
        <p className="mt-2 page-subtitle">
          New to a sport, or new to playing it with strangers? Each guide covers how a pickup
          session usually runs, what to bring, the positions people play, and the unwritten rules
          that keep it fun — plus how to find a game on BallaCity.
        </p>

        <ul className="mt-6 grid gap-3">
          {SPORT_GUIDES.map((g) => (
            <li key={g.slug}>
              <Link
                to="/guide/$sport"
                params={{ sport: g.slug }}
                className="flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-4 transition-colors hover:border-lime/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden className="text-2xl leading-none">
                  {g.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-bold">{g.sport}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{g.tagline}</span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {g.groupSize} · {g.sessionLength}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <section className="mt-8 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">Read next</h2>
          <Link
            to="/blog/how-to-find-pickup-soccer-games"
            className="mt-2 block text-sm font-semibold text-lime"
          >
            How to find pickup soccer games near you →
          </Link>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">Playing safely</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Games are organized by hosts, not by BallaCity. Read the Safety Center before your first
            session, and tell someone where you're playing.
          </p>
          <PolicyLinks className="mt-3" />
        </section>
      </main>
    </div>
  );
}
