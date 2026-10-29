import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { BackHeader } from "@/components/layout/BackHeader";
import { PolicyLinks } from "@/components/PolicyLinks";
import { SampleImage } from "@/components/public/SampleImage";
import { useAuth } from "@/hooks/use-auth";
import { trackEvent } from "@/lib/analytics";
import { getSportHubListings } from "@/lib/city-pages.functions";
import { formatWhen } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { SPORT_HUBS, hubBySlug, rememberSportContext } from "@/lib/sport-hubs";

/**
 * Public sport hub (/basketball, /baseball, …). Slugs come from the canonical
 * sport guide list; anything else 404s. Static routes outrank this one, so it
 * cannot shadow an existing page. Content is the same adult-only public data
 * the city pages use, never invented.
 */
export const Route = createFileRoute("/$sport")({
  loader: async ({ params }) => {
    const hub = hubBySlug(params.sport);
    if (!hub) throw notFound();
    const listings = await getSportHubListings({ data: { sport: hub.slug } });
    if (!listings) throw notFound();
    return { slug: hub.slug, listings };
  },
  head: ({ loaderData, params }) => {
    const hub = hubBySlug(params.sport);
    if (!hub || !loaderData) {
      return pageHead({
        title: "Page not found — BallaCity",
        description: "We don't have a page here.",
        noindex: true,
      });
    }
    const s = hub.sport.toLowerCase();
    return pageHead({
      path: `/${hub.slug}`,
      title: `${hub.sport} Games, Teams & Players Near You | BallaCity`,
      description: `${hub.subhead} Find ${s} games, join teams and connect with players on BallaCity — free.`,
    });
  },
  component: SportHubPage,
  notFoundComponent: () => (
    <div className="min-h-dvh bg-background">
      <BackHeader title="BallaCity" fallbackTo="/" />
      <main className="page-shell-prose py-10">
        <h1 className="page-title">Page not found</h1>
        <p className="mt-2 page-subtitle">We couldn't find that page.</p>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center text-lime">
          Back to BallaCity
        </Link>
      </main>
    </div>
  ),
});

const card =
  "flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:border-lime/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function SportHubPage() {
  const { slug, listings } = Route.useLoaderData();
  const hub = hubBySlug(slug)!;
  const { user } = useAuth();
  const empty =
    listings.games.length + listings.teams.length + listings.trainers.length === 0;

  useEffect(() => {
    trackEvent("view_sport_hub", { sport: hub.sport });
  }, [hub.sport]);

  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title={hub.sport} fallbackTo="/" />
      <main className="page-shell-prose py-6 pb-28">
        <p className="section-eyebrow">
          <span aria-hidden>{hub.emoji}</span> {hub.sport} on BallaCity
        </p>
        <h1 className="page-title mt-1">{hub.headline}</h1>
        <p className="mt-2 page-subtitle">{hub.subhead}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {user ? (
            <>
              <Link
                to="/feed"
                search={{ sport: hub.sport } as never}
                className="inline-flex min-h-11 items-center rounded-full bg-lime-gradient px-5 text-sm font-bold text-primary-foreground"
              >
                Find {hub.sport.toLowerCase()} games
              </Link>
              <Link
                to="/create"
                className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-semibold"
              >
                Host a game
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                onClick={() => rememberSportContext(hub.sport)}
                className="inline-flex min-h-11 items-center rounded-full bg-lime-gradient px-5 text-sm font-bold text-primary-foreground"
              >
                Join free for {hub.sport.toLowerCase()}
              </Link>
              <Link
                to="/auth"
                onClick={() => rememberSportContext(hub.sport)}
                className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-semibold"
              >
                Sign in
              </Link>
            </>
          )}
        </div>

        {empty && (
          <p className="mt-8 text-sm text-muted-foreground">
            No public {hub.sport.toLowerCase()} listings yet. Be the first to host a game.
          </p>
        )}

        {listings.games.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">Upcoming games</h2>
            <ul className="mt-3 grid gap-3">
              {listings.games.map((g) => (
                <li key={g.id}>
                  <Link to="/games/$gameId" params={{ gameId: g.id }} className={card}>
                    <SampleImage sport={g.sport} className="h-14 w-14 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-bold">{g.title}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {formatWhen(g.date)} ·{" "}
                        {[g.location, g.neighborhood].filter(Boolean).join(" · ")} ·{" "}
                        {g.price ? `$${g.price}` : "Free"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {listings.teams.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">Teams</h2>
            <ul className="mt-3 grid gap-3">
              {listings.teams.map((t) => (
                <li key={t.id}>
                  <Link to="/teams/$teamId" params={{ teamId: t.id }} className={card}>
                    <SampleImage sport={hub.sport} className="h-14 w-14 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-bold">{t.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {t.tagline || t.city || hub.sport}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {listings.trainers.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">Coaches &amp; trainers</h2>
            <ul className="mt-3 grid gap-3">
              {listings.trainers.map((t) => (
                <li key={t.id}>
                  <Link to="/trainers/$trainerId" params={{ trainerId: t.id }} className={card}>
                    <SampleImage sport={hub.sport} className="h-14 w-14 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-bold">{t.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {t.tagline || t.city || hub.sport}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="text-lg font-bold">New to {hub.sport.toLowerCase()} pickup?</h2>
          <Link
            to="/guide/$sport"
            params={{ sport: hub.slug }}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-lime"
          >
            Read the {hub.sport.toLowerCase()} guide
          </Link>
        </section>

        <nav aria-label="Other sports" className="mt-8">
          <h2 className="section-eyebrow">More sports</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {SPORT_HUBS.filter((h) => h.slug !== hub.slug).map((h) => (
              <li key={h.slug}>
                <Link
                  to="/$sport"
                  params={{ sport: h.slug }}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-xs font-semibold"
                >
                  <span aria-hidden>{h.emoji}</span> {h.sport}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <PolicyLinks />
      </main>
    </div>
  );
}
