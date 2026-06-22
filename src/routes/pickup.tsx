import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias: /pickup is the user-facing label for the Pickup feed,
// which lives at /feed. Deep links to /pickup redirect there.
export const Route = createFileRoute("/pickup")({
  beforeLoad: () => {
    throw redirect({ to: "/feed", replace: true });
  },
});
