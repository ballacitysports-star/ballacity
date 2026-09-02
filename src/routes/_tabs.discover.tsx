import { createFileRoute, redirect } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";

// Merged into /feed as the "Map" view of the unified Play surface.
// Kept as a redirect so external links and older clients still resolve.
export const Route = createFileRoute("/_tabs/discover")({
  head: () =>
    pageHead({
      path: "/discover",
      title: "Discover games — ballaCity",
      description:
        "Search nearby pickup games on a map or in a list and filter by sport, skill, and time.",
      noindex: true,
    }),
  beforeLoad: () => {
    throw redirect({ to: "/feed", replace: true });
  },
});
