import { createFileRoute, redirect } from "@tanstack/react-router";

// P2-8: roster invites live in the team's Manage page, Invitations tab. Kept as a
// redirect so older links and bookmarks still resolve. The Manage page does its own
// sign-in and permission checks.
export const Route = createFileRoute("/teams/$teamId/invites")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/teams/$teamId/manage",
      params: { teamId: params.teamId },
      search: { tab: "invites" },
      replace: true,
    });
  },
});
