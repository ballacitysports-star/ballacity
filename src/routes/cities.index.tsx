import { createFileRoute, Link } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { pageHead, SITE_URL } from "@/lib/seo";
import { LAUNCH_CITIES, cityLabel } from "@/lib/launch-cities";

export const Route = createFileRoute("/cities/")({
  head: () =>
    pageHead({
      path: "/cities",
      title: "Pickup Games by City — BallaCity",
      description:
        "Find pickup basketball, soccer, baseball, pickleball and more in your city. Browse upcoming games, teams, trainers and gyms across major US cities.",
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
  component: CitiesIndex,
});

function CitiesIndex() {
  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Cities" fallbackTo="/" />
      <main className="page-shell-prose py-6 pb-28">
        <h1 className="page-title">Pickup games by city</h1>
        <p className="mt-2 page-subtitle">
          Pick your city to see upcoming games, teams, trainers and gyms near you.
        </p>
        <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
      </main>
    </div>
  );
}
