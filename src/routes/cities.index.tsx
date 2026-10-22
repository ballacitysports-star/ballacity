import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Calendar, MapPin, Navigation } from "lucide-react";
import { BackHeader } from "@/components/layout/BackHeader";
import { PolicyLinks } from "@/components/PolicyLinks";
import { getCityListings } from "@/lib/city-pages.functions";
import { filterBySport, type CityGameRow } from "@/lib/city-seo";
import { formatWhen } from "@/lib/format";
import { LAUNCH_CITIES, cityBySlug, cityLabel, distanceKm } from "@/lib/launch-cities";
import { pageHead, SITE_URL } from "@/lib/seo";
import { SPORT_GUIDES } from "@/lib/sports-guide";

const CITY_KEY = "bc.publicFeedCity";
const DEFAULT_CITY = LAUNCH_CITIES[0];

type Search = { city?: string; sport?: string };

const card =
  "block rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-lime/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chip =
  "inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors";

export const Route = createFileRoute("/cities/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    city: typeof s.city === "string" && cityBySlug(s.city) ? s.city : undefined,
    sport:
      typeof s.sport === "string" && SPORT_GUIDES.some((g) => g.sport === s.sport)
        ? s.sport
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ city: search.city }),
  loader: async ({ deps }) => {
    const city = cityBySlug(deps.city ?? "") ?? DEFAULT_CITY;
    const res = await getCityListings({ data: { city: city.slug } }).catch(() => null);
    return { citySlug: city.slug, listings: res?.listings ?? null };
  },
  head: () =>
    pageHead({
      path: "/cities",
      title: "Pickup Games by City — BallaCity",
      description:
        "Find pickup basketball, soccer, baseball, pickleball and more in your city. Browse upcoming games, teams and gyms across major US cities.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "BallaCity cities",
        itemListElement: LAUNCH_CITIES.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: cityLabel(c),
          url: `${SITE_URL}/cities/${c.slug}`,
        })),
      },
    }),
  component: PublicFeed,
});

function emojiFor(sport: string) {
  return SPORT_GUIDES.find((g) => g.sport.toLowerCase() === sport.toLowerCase())?.emoji ?? "🏅";
}

function GameRow({ g }: { g: CityGameRow }) {
  return (
    <Link to="/games/$gameId" params={{ gameId: g.id }} className={card}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-background text-2xl"
        >
          {emojiFor(g.sport)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{g.title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" aria-hidden /> {formatWhen(g.date)}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {[g.location, g.neighborhood].filter(Boolean).join(" · ")}
            </span>
          </p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full bg-background px-2.5 py-1">{g.sport}</span>
        {g.skill && <span className="rounded-full bg-background px-2.5 py-1">{g.skill}</span>}
        <span className="rounded-full bg-background px-2.5 py-1 text-lime">
          {g.price ? `$${g.price}` : "Free"}
        </span>
      </div>
    </Link>
  );
}

function PublicFeed() {
  const { citySlug, listings: all } = Route.useLoaderData();
  const { city: cityParam, sport } = Route.useSearch();
  const navigate = useNavigate({ from: "/cities/" });
  const city = cityBySlug(citySlug) ?? DEFAULT_CITY;
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  // Remember the visitor's city on this device only; the server never sees it.
  useEffect(() => {
    try {
      if (cityParam) {
        localStorage.setItem(CITY_KEY, cityParam);
      } else {
        const stored = localStorage.getItem(CITY_KEY);
        if (stored && cityBySlug(stored)) {
          void navigate({ search: (s) => ({ ...s, city: stored }), replace: true });
        }
      }
    } catch {
      // Storage can be blocked; the page works without it.
    }
  }, [cityParam, navigate]);

  const setCity = (slug: string) =>
    void navigate({ search: (s) => ({ ...s, city: slug }), replace: true });
  const setSport = (value: string | undefined) =>
    void navigate({ search: (s) => ({ ...s, sport: value }), replace: true });

  const listings = all && sport ? filterBySport(all, sport) : all;

  // The browser reports coordinates to this page only; just the nearest city
  // name is used and no position is sent to the server.
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationNote("Location isn't available on this device. Pick a city instead.");
      return;
    }
    setLocating(true);
    setLocationNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        const nearest = LAUNCH_CITIES.reduce((best, c) =>
          distanceKm(c.lat, c.lng, latitude, longitude) <
          distanceKm(best.lat, best.lng, latitude, longitude)
            ? c
            : best,
        );
        const km = distanceKm(nearest.lat, nearest.lng, latitude, longitude);
        if (km > nearest.radiusKm * 3) {
          setLocationNote("We're not in your area yet. Showing the closest city.");
        }
        setCity(nearest.slug);
      },
      () => {
        setLocating(false);
        setLocationNote("Couldn't get your location. Pick a city instead.");
      },
      { timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  };

  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Find games" fallbackTo="/" />
      <main className="page-shell-prose py-6 pb-28">
        <h1 className="page-title">Games in {cityLabel(city)}</h1>
        <p className="mt-2 page-subtitle">
          Upcoming public pickup runs, plus teams and gyms nearby. Browse freely; you only need an
          account to join or host.
        </p>

        <div className="mt-5 flex gap-2">
          <label className="sr-only" htmlFor="city-select">
            City
          </label>
          <select
            id="city-select"
            value={city.slug}
            onChange={(e) => setCity(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-semibold"
          >
            {LAUNCH_CITIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {cityLabel(c)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:border-lime/40 disabled:opacity-60"
          >
            <Navigation className="h-4 w-4" aria-hidden />
            {locating ? "Locating…" : "Near me"}
          </button>
        </div>
        {locationNote && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {locationNote}
          </p>
        )}

        <div
          role="group"
          aria-label="Filter by sport"
          className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          <button
            type="button"
            aria-pressed={!sport}
            onClick={() => setSport(undefined)}
            className={`${chip} ${!sport ? "border-lime bg-lime text-primary-foreground" : "border-border"}`}
          >
            All sports
          </button>
          {SPORT_GUIDES.map((g) => (
            <button
              key={g.slug}
              type="button"
              aria-pressed={sport === g.sport}
              onClick={() => setSport(g.sport)}
              className={`${chip} ${sport === g.sport ? "border-lime bg-lime text-primary-foreground" : "border-border"}`}
            >
              <span aria-hidden>{g.emoji}</span> {g.sport}
            </button>
          ))}
        </div>

        {!listings ? (
          <div className="mt-8 rounded-2xl border border-border bg-surface p-6 text-center">
            <p className="font-semibold">Couldn't load games right now.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 text-sm font-semibold text-lime"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <section className="mt-6" aria-labelledby="games-h">
              <h2 id="games-h" className="text-lg font-bold">
                Upcoming games
              </h2>
              {listings.games.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-border bg-surface p-6 text-center">
                  <p className="font-semibold">
                    No public {sport ? sport.toLowerCase() : ""} games listed yet.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Be the first to host one in {city.name}. It takes about a minute.
                  </p>
                  <Link
                    to="/create"
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-lime-gradient px-5 text-sm font-bold text-primary-foreground"
                  >
                    Host a game <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {listings.games.map((g) => (
                    <li key={g.id}>
                      <GameRow g={g} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {listings.teams.length > 0 && (
              <section className="mt-8" aria-labelledby="teams-h">
                <h2 id="teams-h" className="text-lg font-bold">
                  Teams
                </h2>
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

            {listings.gyms.length > 0 && (
              <section className="mt-8" aria-labelledby="gyms-h">
                <h2 id="gyms-h" className="text-lg font-bold">
                  Venues
                </h2>
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
          </>
        )}

        <section className="mt-8 rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-sm font-bold">Want to join a run?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a free account to request a spot, message hosts and get game alerts.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/auth"
              className="inline-flex min-h-11 items-center rounded-full bg-lime px-5 text-sm font-bold text-primary-foreground"
            >
              Sign up or sign in
            </Link>
            <Link
              to="/guide"
              className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-semibold"
            >
              How pickup works
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Games are organized by hosts, not by BallaCity.
          </p>
          <PolicyLinks className="mt-3" />
        </section>

        <nav aria-label="All cities" className="mt-8">
          <h2 className="text-sm font-bold text-muted-foreground">All cities</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LAUNCH_CITIES.map((c) => (
              <li key={c.slug}>
                <Link
                  to="/cities/$city"
                  params={{ city: c.slug }}
                  className="flex min-h-11 items-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold transition-colors hover:border-lime/40"
                >
                  {cityLabel(c)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
