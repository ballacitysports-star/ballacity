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
} from "@/lib/city-seo";
import { cityBySlug } from "@/lib/launch-cities";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/cities/$city/")({
  loader: async ({ params }) => {
    const city = cityBySlug(params.city);
    if (!city) throw notFound();
    const res = await getCityListings({ data: { city: city.slug } });
    if (!res) throw notFound();
    return { citySlug: city.slug, listings: res.listings };
  },
  head: ({ loaderData, params }) => {
    const city = cityBySlug(params.city);
    if (!city || !loaderData) {
      return pageHead({
        title: "City not found — BallaCity",
        description: "We don't have a page for that city yet.",
        noindex: true,
      });
    }
    const path = `/cities/${city.slug}`;
    return pageHead({
      path,
      title: cityTitle(city),
      description: cityDescription(city, loaderData.listings),
      // A city with almost nothing listed is a thin page; keep it out of search.
      noindex: listingCount(loaderData.listings) < MIN_LISTINGS_TO_INDEX,
      jsonLd: buildCityJsonLd(city, loaderData.listings, path),
    });
  },
  component: CityPage,
  notFoundComponent: () => (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Cities" fallbackTo="/cities" />
      <main className="page-shell-prose py-10">
        <h1 className="page-title">City not found</h1>
        <p className="mt-2 page-subtitle">We're not in that city yet.</p>
        <Link to="/cities" className="mt-5 inline-flex min-h-11 items-center text-lime">
          See all cities
        </Link>
      </main>
    </div>
  ),
});

function CityPage() {
  const { citySlug, listings } = Route.useLoaderData();
  return <CityListingsView city={cityBySlug(citySlug)!} listings={listings} />;
}
