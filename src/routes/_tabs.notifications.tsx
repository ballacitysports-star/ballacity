import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Alerts live in the Inbox now, next to Messages. This path stays so old links,
 * push notifications and bookmarks still land in the right place.
 */
export const Route = createFileRoute("/_tabs/notifications")({
  beforeLoad: () => {
    throw redirect({ to: "/messages", search: { tab: "alerts" }, replace: true });
  },
});
