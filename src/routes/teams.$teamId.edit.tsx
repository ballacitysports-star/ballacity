import { withRequireAuth } from "@/components/RequireAuth";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { ensureOrgById } from "@/lib/org-store";
import type { Org } from "@/lib/sample-data";
import { EditOrgScreen } from "@/components/EditOrgScreen";

export const Route = createFileRoute("/teams/$teamId/edit")({
  head: () =>
    pageHead({
      title: "Edit team — BallaCity",
      description: "Update your team's details, roster, venues, and availability.",
      noindex: true,
    }),
  ssr: false,
  component: withRequireAuth(EditOrg),
  pendingComponent: () => (
    <div className="page-shell-narrow pt-24 text-center text-muted-foreground">Loading editor…</div>
  ),
  errorComponent: ({ error }) => (
    <div className="page-shell-narrow pt-24 text-center">
      <p className="text-muted-foreground">
        {error instanceof Error ? error.message : "Couldn't open editor."}
      </p>
      <Link
        to="/teams"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Teams
      </Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="page-shell-narrow pt-24 text-center">
      <p className="text-muted-foreground">Gym not found.</p>
      <Link
        to="/teams"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Teams
      </Link>
    </div>
  ),
  loader: async ({ params }) => {
    const org = await ensureOrgById(params.teamId);
    if (!org) throw notFound();
    return org;
  },
});

function EditOrg() {
  const org = Route.useLoaderData() as Org;
  return <EditOrgScreen org={org} />;
}
