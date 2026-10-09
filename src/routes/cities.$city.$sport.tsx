import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { CityListingsView } from "@/components/city/CityListingsView";
import { getCityListings } from "@/lib/city-pages.functions";
import {
  MIN_LISTINGS_TO_INDEX,
  buildCityJsonLd,
  cityDescription,
  cityTitle,
  listingCount,
  sportForGuideSlug,
} from "@/lib/city-seo";
import { cityBySlug } from "@/lib/launch-cities";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/cities/$city/$sport")({
  loader: async ({ params }) => {
    const city = cityBySlug(params.city);
    const sport = sportForGuideSlug(params.sport);
    if (!city || !sport) throw notFound();
    const res = await getCityListings({ data: { city: city.slug, sport: params.sport } });
    if (!res) throw notFound();
    return { citySlug: city.slug, sportSlug: params.sport.toLowerCase(), listings: res.listings };
  },
  head: ({ loaderData, params }) => {
    const city = cityBySlug(params.city);
    const sport = sportForGuideSlug(params.sport);
    if (!city || !sport || !loaderData) {
      return pageHead({
        title: "Page not found — BallaCity",
        description: "We don't have a page for that city and sport.",
        noindex: true,
      });
    }
    const path = `/cities/${city.slug}/${params.sport.toLowerCase()}`;
    return pageHead({
      path,
      title: cityTitle(city, sport),
      description: cityDescription(city, loaderData.listings, sport),
      noindex: listingCount(loaderData.listings) < MIN_LISTINGS_TO_INDEX,
      jsonLd: buildCityJsonLd(city, loaderData.listings, path),
    });
  },
  component: CitySportPage,
  notFoundComponent: () => (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Cities" fallbackTo="/cities" />
      <main className="page-shell-prose py-10">
        <h1 className="page-title">Page not found</h1>
        <p className="mt-2 page-subtitle">We don't have that city and sport yet.</p>
        <Link to="/cities" className="mt-5 inline-flex min-h-11 items-center text-lime">
          See all cities
        </Link>
      </main>
    </div>
  ),
});

function CitySportPage() {
  const { citySlug, sportSlug, listings } = Route.useLoaderData();
  return (
    <CityListingsView
      city={cityBySlug(citySlug)!}
      listings={listings}
      sport={{ name: sportForGuideSlug(sportSlug)!, slug: sportSlug }}
    />
  );
}
