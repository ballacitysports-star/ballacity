import { createFileRoute, redirect } from "@tanstack/react-router";

// P2-8: the team waiver lives in the team's Manage page, Waiver tab. Kept as a
// redirect so older links and bookmarks still resolve. The Manage page does its own
// sign-in and permission checks.
export const Route = createFileRoute("/teams/$teamId/waiver")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/teams/$teamId/manage",
      params: { teamId: params.teamId },
      search: { tab: "waiver" },
      replace: true,
    });
  },
});
