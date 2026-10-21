import { Link } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { PolicyLinks } from "@/components/PolicyLinks";
import { formatWhen } from "@/lib/format";
import { listingCount, type CityListings } from "@/lib/city-seo";
import { cityLabel, type LaunchCity } from "@/lib/launch-cities";
import { SPORT_GUIDES } from "@/lib/sports-guide";

const card =
  "block rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:border-lime/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Body shared by /cities/$city and /cities/$city/$sport. Plain links and
 * server-rendered text, so crawlers see the listings without running scripts.
 */
export function CityListingsView({
  city,
  listings,
  sport,
}: {
  city: LaunchCity;
  listings: CityListings;
  /** Guide entry when this is a city×sport page. */
  sport?: { name: string; slug: string };
}) {
  const where = cityLabel(city);
  const empty = listingCount(listings) === 0;
  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title={where} fallbackTo={sport ? `/cities/${city.slug}` : "/cities"} />
      <main className="page-shell-prose py-6 pb-28">
        <h1 className="page-title">
          {sport ? `Pickup ${sport.name} in ${where}` : `Pickup games in ${where}`}
        </h1>
        <p className="mt-2 page-subtitle">
          {sport
            ? `Upcoming ${sport.name.toLowerCase()} runs, teams and trainers around ${city.name}. `
            : `Upcoming runs, teams, trainers and gyms around ${city.name}. `}
          Pick a game, check the skill level and spots left, then request to join.
        </p>

        {!sport && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {SPORT_GUIDES.map((g) => (
              <li key={g.slug}>
                <Link
                  to="/cities/$city/$sport"
                  params={{ city: city.slug, sport: g.slug }}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-xs font-semibold"
                >
                  <span aria-hidden>{g.emoji}</span> {g.sport}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {empty && (
          <p className="mt-8 text-sm text-muted-foreground">
            No public listings here yet. Be the first to host a game in {city.name}.
          </p>
        )}

        {listings.games.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">Upcoming games</h2>
            <ul className="mt-3 grid gap-3">
              {listings.games.map((g) => (
                <li key={g.id}>
                  <Link to="/games/$gameId" params={{ gameId: g.id }} className={card}>
                    <span className="block text-base font-bold">{g.title}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {g.sport} · {formatWhen(g.date)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {[g.location, g.neighborhood].filter(Boolean).join(" · ")} ·{" "}
                      {g.price ? `$${g.price}` : "Free"}
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
                    <span className="block text-base font-bold">{t.name}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {t.tagline || (t.sports ?? []).join(", ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {listings.trainers.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">Trainers</h2>
            <ul className="mt-3 grid gap-3">
              {listings.trainers.map((t) => (
                <li key={t.id}>
                  <Link to="/trainers/$trainerId" params={{ trainerId: t.id }} className={card}>
                    <span className="block text-base font-bold">{t.name}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {t.tagline || (t.sports ?? []).join(", ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {listings.gyms.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">Gyms &amp; courts</h2>
            <ul className="mt-3 grid gap-3">
              {listings.gyms.map((gym) => (
                <li key={gym.id}>
                  <Link to="/orgs/$orgId" params={{ orgId: gym.id }} className={card}>
                    <span className="block text-base font-bold">{gym.name}</span>
                    {gym.category && (
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {gym.category}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">New to pickup?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Read how{" "}
            <Link
              to="/guide/$sport"
              params={{ sport: sport?.slug ?? "basketball" }}
              className="font-semibold text-lime"
            >
              {sport ? sport.name.toLowerCase() : "basketball"} pickup works
            </Link>
            , then follow the Safety Center tips before your first session. Games are organized by
            hosts, not by BallaCity.
          </p>
          <PolicyLinks className="mt-3" />
        </section>
      </main>
    </div>
  );
}
