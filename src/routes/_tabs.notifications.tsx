import { createFileRoute, redirect } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";

// Legacy route: alerts have been merged into the Inbox as a tab.
export const Route = createFileRoute("/_tabs/notifications")({
  head: () =>
    pageHead({
      path: "/notifications",
      title: "Notifications — OpenRun",
      description:
      "Join requests, approvals, messages, and game updates in one place.",
      noindex: true,
    }),
  beforeLoad: () => {
    throw redirect({ to: "/messages", search: { tab: "alerts" } as any });
  },
  component: () => null,
});
