import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The Guardian Dashboard moved into the Parent Center (P1-8). This path stays so old links,
 * bookmarks and notifications keep working: it goes straight to that section.
 */
export const Route = createFileRoute("/guardian")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/parent", hash: "activity", replace: true });
  },
});
