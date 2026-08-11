import { createFileRoute, redirect } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";

// Alias: /pickup is the user-facing label for the Pickup feed,
// which lives at /feed. Deep links to /pickup redirect there.
export const Route = createFileRoute("/pickup")({
  head: () =>
    pageHead({
      path: "/pickup",
      title: "Pickup games — OpenRun",
      description:
      "Browse open pickup runs by sport, skill level, and distance, then request to join in a tap.",
    }),
  beforeLoad: () => {
    throw redirect({ to: "/feed", replace: true });
  },
});
