import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into /feed as the "Map" view of the unified Play surface.
// Kept as a redirect so external links and older clients still resolve.
export const Route = createFileRoute("/_tabs/discover")({
  beforeLoad: () => {
    throw redirect({ to: "/feed", replace: true });
  },
});
