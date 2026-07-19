import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy route: alerts have been merged into the Inbox as a tab.
export const Route = createFileRoute("/_tabs/notifications")({
  beforeLoad: () => {
    throw redirect({ to: "/messages", search: { tab: "alerts" } as any });
  },
  component: () => null,
});
