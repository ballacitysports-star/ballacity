import { withRequireAuth } from "@/components/RequireAuth";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { ensureOrgById, getOrgById } from "@/lib/org-store";
import type { Org } from "@/lib/sample-data";
import { EditOrgScreen } from "@/components/EditOrgScreen";

export const Route = createFileRoute("/trainers/$trainerId/edit")({
  head: () =>
    pageHead({
      title: "Edit trainer profile — BallaCity",
      description: "Update your trainer details, session types, and availability.",
      noindex: true,
    }),
  ssr: false,
  loader: async ({ params }) => {
    const org = await ensureOrgById(params.trainerId);
    if (!org) throw notFound();
    return org;
  },
  pendingComponent: () => (
    <div className="page-shell-narrow pt-24 text-center text-muted-foreground">Loading editor…</div>
  ),
  errorComponent: ({ error }) => (
    <div className="page-shell-narrow pt-24 text-center">
      <p className="text-muted-foreground">
        {error instanceof Error ? error.message : "Couldn't open editor."}
      </p>
      <Link
        to="/trainers"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Trainers
      </Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="page-shell-narrow pt-24 text-center">
      <p className="text-muted-foreground">Trainer not found.</p>
      <Link
        to="/trainers"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Trainers
      </Link>
    </div>
  ),
  component: withRequireAuth(EditTrainerRoute),
});

function EditTrainerRoute() {
  const org = Route.useLoaderData() as Org;
  return <EditOrgScreen org={org} />;
}
